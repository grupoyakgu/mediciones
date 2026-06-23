import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile } from '@/lib/file-parser'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const SETTINGS_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

function extractJsonArray(text: string): Record<string, unknown>[] | null {
  const start = text.indexOf('[')
  if (start === -1) return null

  // 1. Try direct parse
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
  } catch { /* continue */ }

  // 2. Slice from [ to last ] — handles trailing notes/text after the array
  const end = text.lastIndexOf(']')
  if (end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  // 3. Truncation recovery — find last complete object and close the array
  const candidate = text.slice(start)
  const lastObj = candidate.lastIndexOf('},')
  const closeAt = lastObj !== -1 ? lastObj + 1 : candidate.lastIndexOf('}')
  if (closeAt > 0) {
    try {
      const parsed = JSON.parse(candidate.slice(0, closeAt + 1) + ']')
      if (Array.isArray(parsed)) return parsed
    } catch { /* continue */ }
  }

  return null
}

export async function POST(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const formData = await req.formData()
  const file = formData.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })

  const buffer = Buffer.from(await file.arrayBuffer())
  let content: string
  try {
    content = await parseFile(buffer, file.type, file.name)
  } catch (e) {
    return NextResponse.json({ error: `Could not read file: ${String(e)}` }, { status: 422 })
  }

  if (!content || content.length < 20) {
    return NextResponse.json({ error: 'File appears empty or unreadable. For PDFs, ensure text is selectable (not a scanned image).' }, { status: 422 })
  }

  let claudeResponse: string
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are parsing a Bill of Quantities (BOQ / Presupuesto / Mediciones) file. The file may be in English or Spanish. Extract all entries and return a JSON array.

Spanish terminology mapping:
- "Capítulo" or "Cap." = chapter_id / chapter_name
- "Partida" or "Cod." = item_code
- "Descripción" or "Concepto" = description
- "Ud" / "Uds" / "Unidad" = unit
- "Medición" / "Cantidad" = quantity
- "Precio" / "P.U." / "Precio Unitario" = unit_price
- "Importe" / "Total" / "Presupuesto" = total_amount

Each element must have these fields (use null when not available):
- chapter_id: string | null
- chapter_name: string | null
- item_code: string | null
- description: string (required, use original language)
- unit: string | null
- quantity: number | null
- unit_price: number | null
- total_amount: number | null

Rules:
- Include chapter/capítulo header rows (set description to the chapter name).
- Skip completely blank rows.
- Numbers must be plain numbers — remove currency symbols, thousand separators (. or ,), keep decimal point as a period.
- Return ONLY a raw JSON array, no markdown, no code fences, no explanation.

File content:
${content.slice(0, 14000)}`
      }]
    })
    const block = response.content[0]
    if (block.type !== 'text') throw new Error('Unexpected Claude response type')
    claudeResponse = block.text
  } catch (e) {
    return NextResponse.json({ error: `Claude API error: ${String(e)}` }, { status: 500 })
  }

  const jsonText = claudeResponse
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim()

  const items = extractJsonArray(jsonText)

  if (!items) {
    return NextResponse.json({
      error: `Could not parse BOQ response. First 300 chars: ${jsonText.slice(0, 300)}`
    }, { status: 422 })
  }

  await supabase.from('invoice_items').update({ boq_item_id: null }).not('boq_item_id', 'is', null)
  await supabase.from('boq_items').delete().not('id', 'is', null)

  const rows = items
    .filter(item => item.description)
    .map(item => ({
      chapter_id: (item.chapter_id as string) ?? null,
      chapter_name: (item.chapter_name as string) ?? null,
      item_code: (item.item_code as string) ?? null,
      description: item.description as string,
      unit: (item.unit as string) ?? null,
      quantity: (item.quantity as number) ?? 0,
      unit_price: (item.unit_price as number) ?? 0,
      total_amount: (item.total_amount as number) ??
        ((item.quantity as number ?? 0) * (item.unit_price as number ?? 0)),
    }))

  if (rows.length > 0) {
    const { error: insertErr } = await supabase.from('boq_items').insert(rows)
    if (insertErr) return NextResponse.json({ error: `DB insert error: ${insertErr.message}` }, { status: 500 })
  }

  await supabase.from('settings').update({
    boq_file_name: file.name,
    boq_uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', SETTINGS_ID)

  return NextResponse.json({ ok: true, count: rows.length })
}

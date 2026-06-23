import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile } from '@/lib/file-parser'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
const SETTINGS_ID = 'aaaaaaaa-0000-0000-0000-000000000001'

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
        content: `You are parsing a Bill of Quantities (BOQ / Mediciones) file. Extract all entries and return a JSON array.

Each element must have these fields (use null when not available):
- chapter_id: string | null
- chapter_name: string | null
- item_code: string | null
- description: string (required)
- unit: string | null
- quantity: number | null
- unit_price: number | null
- total_amount: number | null

Rules:
- Include chapter header rows.
- Skip blank rows.
- Numbers must be plain numbers, no symbols or thousand separators.
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

  let jsonText = claudeResponse.trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim()

  let items: Record<string, unknown>[] | null = null
  try {
    const parsed = JSON.parse(jsonText)
    if (Array.isArray(parsed)) items = parsed
  } catch {
    const match = jsonText.match(/\[[\s\S]*/)
    if (match) {
      let candidate = match[0]
      if (!candidate.trimEnd().endsWith(']')) {
        const lastComma = candidate.lastIndexOf('},')
        if (lastComma !== -1) {
          candidate = candidate.slice(0, lastComma + 1) + ']'
        } else {
          candidate = candidate + ']'
        }
      }
      try {
        const parsed = JSON.parse(candidate)
        if (Array.isArray(parsed)) items = parsed
      } catch { /* ignore */ }
    }
  }

  if (!items) {
    return NextResponse.json({
      error: `Could not parse Claude's response as JSON. First 300 chars: ${jsonText.slice(0, 300)}`
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

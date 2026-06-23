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

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `You are parsing a Bill of Quantities (BOQ / Mediciones) file. Extract all entries and return a JSON array.

Each element must have these fields (use null when not available):
- chapter_id: string | null  (e.g. "1", "2.3")
- chapter_name: string | null  (section/chapter title)
- item_code: string | null  (item reference code)
- description: string  (item or chapter description — required)
- unit: string | null  (m2, ml, ud, kg, etc.)
- quantity: number | null
- unit_price: number | null  (EUR)
- total_amount: number | null

Rules:
- Include chapter header rows (they have description but usually no quantity/unit_price).
- Skip blank rows.
- Numbers should be plain numbers, no currency symbols or thousand separators.
- Return ONLY a valid JSON array with no markdown or explanation.

File content:
${content.slice(0, 14000)}`
    }]
  })

  const block = response.content[0]
  if (block.type !== 'text') return NextResponse.json({ error: 'Unexpected Claude response' }, { status: 500 })

  let items: Record<string, unknown>[]
  try {
    const match = block.text.match(/\[[\s\S]*\]/)
    items = JSON.parse(match ? match[0] : block.text)
    if (!Array.isArray(items)) throw new Error('Not an array')
  } catch {
    return NextResponse.json({ error: 'Failed to parse extracted BOQ structure' }, { status: 422 })
  }

  // Clear existing BOQ (set FK references to null first to avoid constraint errors)
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
      total_amount: (item.total_amount as number) ?? ((item.quantity as number ?? 0) * (item.unit_price as number ?? 0)),
    }))

  if (rows.length > 0) {
    const { error } = await supabase.from('boq_items').insert(rows)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  await supabase.from('settings').update({
    boq_file_name: file.name,
    boq_uploaded_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', SETTINGS_ID)

  return NextResponse.json({ ok: true, count: rows.length })
}

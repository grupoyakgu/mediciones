import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as XLSX from 'xlsx'

function stripFences(text: string): string {
  return text.replace(/^```[\w]*[\r\n]?/, '').replace(/[\r\n]?```\s*$/, '').trim()
}

async function parseWithClaude(content: string, filename: string): Promise<Record<string, unknown>[]> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `You are parsing a Bill of Quantities (BOQ / Mediciones) file.\n\nExtract ALL line items from this file. Return a JSON array where each element has:\n- chapter_id: string (e.g. "01", "01.01", "02")\n- chapter_name: string (chapter/section name)\n- item_code: string (item reference code, may be empty)\n- description: string (item description)\n- unit: string (unit of measure)\n- quantity: number or null\n- unit_price: number or null\n- total_amount: number or null\n\nReturn ONLY a JSON array with no explanation. File: ${filename}\n\nContent:\n${content.slice(0, 60000)}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  const parsed = JSON.parse(stripFences(block.text))
  if (!Array.isArray(parsed)) throw new Error('Expected array from Claude')
  return parsed
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file || !projectId) {
      return NextResponse.json({ error: 'Missing file or projectId' }, { status: 400 })
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )

    let content = ''
    const filename = file.name.toLowerCase()

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(buffer, { type: 'array' })
      const sheet = workbook.Sheets[workbook.SheetNames[0]]
      content = XLSX.utils.sheet_to_csv(sheet)
    } else {
      content = await file.text()
    }

    const items = await parseWithClaude(content, file.name)

    await supabase.from('boq_items').delete().eq('project_id', projectId)

    const BATCH = 200
    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH).map((item) => ({
        project_id: projectId,
        chapter_id: String(item.chapter_id ?? ''),
        chapter_name: String(item.chapter_name ?? ''),
        item_code: String(item.item_code ?? ''),
        description: String(item.description ?? ''),
        unit: String(item.unit ?? ''),
        quantity: item.quantity != null ? Number(item.quantity) : null,
        unit_price: item.unit_price != null ? Number(item.unit_price) : null,
        total_amount: item.total_amount != null ? Number(item.total_amount) : null,
      }))
      const { error } = await supabase.from('boq_items').insert(batch)
      if (error) throw new Error(error.message)
    }

    await supabase.from('projects').update({ boq_uploaded: true }).eq('id', projectId)

    return NextResponse.json({ success: true, count: items.length })
  } catch (err) {
    console.error('[boq/upload]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

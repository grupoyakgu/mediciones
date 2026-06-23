import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'
import * as XLSX from 'xlsx'

function stripFences(text: string): string {
  return text.replace(/^```[\w]*[\r\n]?/, '').replace(/[\r\n]?```\s*$/, '').trim()
}

async function parseInvoiceWithClaude(content: string, filename: string): Promise<{
  invoice_number: string
  invoice_date: string
  supplier: string
  total_amount: number
  items: Record<string, unknown>[]
}> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

  const prompt = `Parse this invoice/certificate file and extract:

1. Invoice metadata (invoice_number, invoice_date as YYYY-MM-DD, supplier name, total_amount as number)
2. All line items, each with:
   - description: string
   - unit: string
   - quantity: number or null
   - unit_price: number or null
   - total_amount: number or null
   - item_code: string (if present)

Return ONLY a JSON object with structure:
{
  "invoice_number": "...",
  "invoice_date": "YYYY-MM-DD",
  "supplier": "...",
  "total_amount": 0,
  "items": [...]
}

File: ${filename}

Content:
${content.slice(0, 60000)}`

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{ role: 'user', content: prompt }],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type')
  return JSON.parse(stripFences(block.text))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function matchInvoiceItemsToBoq(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  projectId: string,
  invoiceItems: Record<string, unknown>[]
): Promise<{ boq_item_id: string | null; match_status: string; boq_unit_price: number | null; boq_qty: number | null; description: string; unit: string; quantity: number | null; unit_price: number | null; total_amount: number | null; item_code: string }[]> {
  const PAGE = 500
  let from = 0
  const boqItems: Record<string, unknown>[] = []
  while (true) {
    const { data } = await supabase
      .from('boq_items')
      .select('id,description,unit,unit_price,quantity,item_code')
      .eq('project_id', projectId)
      .range(from, from + PAGE - 1)
    if (!data || data.length === 0) break
    boqItems.push(...data)
    if (data.length < PAGE) break
    from += PAGE
  }

  return invoiceItems.map((item) => {
    const desc = String(item.description ?? '').toLowerCase()
    const code = String(item.item_code ?? '').toLowerCase()

    let match = boqItems.find((b) => code && String(b.item_code ?? '').toLowerCase() === code)
    if (!match) {
      match = boqItems.find((b) => {
        const bDesc = String(b.description ?? '').toLowerCase()
        return bDesc === desc || (desc.length > 10 && bDesc.includes(desc.slice(0, Math.min(30, desc.length))))
      })
    }

    return {
      boq_item_id: match ? String(match.id) : null,
      match_status: match ? 'matched' : 'not_in_boq',
      boq_unit_price: match ? (match.unit_price as number | null) : null,
      boq_qty: match ? (match.quantity as number | null) : null,
      description: String(item.description ?? ''),
      unit: String(item.unit ?? ''),
      quantity: item.quantity != null ? Number(item.quantity) : null,
      unit_price: item.unit_price != null ? Number(item.unit_price) : null,
      total_amount: item.total_amount != null ? Number(item.total_amount) : null,
      item_code: String(item.item_code ?? ''),
    }
  })
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
    } else if (filename.endsWith('.pdf')) {
      content = `[PDF file: ${file.name}] - PDF text extraction not available. Please convert to XLSX or CSV for best results.`
    } else {
      content = await file.text()
    }

    const parsed = await parseInvoiceWithClaude(content, file.name)
    const matchedItems = await matchInvoiceItemsToBoq(supabase, projectId, parsed.items)

    const { data: invoice, error: invError } = await supabase
      .from('invoices')
      .insert({
        project_id: projectId,
        invoice_number: parsed.invoice_number,
        invoice_date: parsed.invoice_date,
        supplier: parsed.supplier,
        total_amount: parsed.total_amount,
        status: 'processed',
      })
      .select('id')
      .single()

    if (invError || !invoice) throw new Error(invError?.message ?? 'Failed to create invoice')

    if (matchedItems.length > 0) {
      const { error: itemsError } = await supabase
        .from('invoice_items')
        .insert(
          matchedItems.map((it) => ({
            invoice_id: invoice.id,
            boq_item_id: it.boq_item_id,
            match_status: it.match_status,
            boq_unit_price: it.boq_unit_price,
            boq_qty: it.boq_qty,
            description: it.description,
            unit: it.unit,
            quantity: it.quantity,
            unit_price: it.unit_price,
            total_amount: it.total_amount,
            item_code: it.item_code,
          }))
        )
      if (itemsError) throw new Error(itemsError.message)
    }

    return NextResponse.json({ success: true, invoiceId: invoice.id, itemCount: matchedItems.length })
  } catch (err) {
    console.error('[invoices/upload]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

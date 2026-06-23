import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isSupportedFile, parseFileContent } from '@/lib/file-parser'
import { claudeCreate } from '@/lib/claude'

interface InvoiceItem {
  description: string
  unit?: string
  quantity?: number
  unit_price?: number
  total_amount?: number
}

interface InvoiceData {
  invoice_number?: string
  supplier?: string
  invoice_date?: string
  total_amount?: number
  currency?: string
  items: InvoiceItem[]
}

function extractJsonObject(text: string): InvoiceData | null {
  try {
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.items)) return parsed
  } catch {}
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (parsed && Array.isArray(parsed.items)) return parsed
    } catch {}
  }
  return null
}

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: 'No projectId provided' }, { status: 400 })
    if (!isSupportedFile(file.name)) {
      return NextResponse.json({ error: 'Unsupported file type. Please upload PDF, CSV, or Excel.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const content = await parseFileContent(buffer, file.name)

    const message = await claudeCreate({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `Extract invoice data from this document and return ONLY a JSON object.

Return format:
{
  "invoice_number": "string or null",
  "supplier": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "currency": "EUR",
  "items": [
    {
      "description": "string",
      "unit": "string or null",
      "quantity": number or null,
      "unit_price": number or null,
      "total_amount": number or null
    }
  ]
}

Spanish column names: Descripción/Concepto=description, Ud/Unidad=unit, Cantidad/Medición=quantity, Precio/P.U.=unit_price, Importe/Total=total_amount.
Return ONLY the JSON object, no other text.

Document:
${content}`
      }]
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
    const invoiceData = extractJsonObject(rawText)
    if (!invoiceData) {
      return NextResponse.json(
        { error: `Could not parse invoice JSON. First 300 chars: ${rawText.slice(0, 300)}` },
        { status: 500 }
      )
    }

    const cookieStore = cookies()
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll: () => cookieStore.getAll(),
          setAll: (toSet: { name: string; value: string; options: Parameters<typeof cookieStore.set>[2] }[]) => {
            toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
          }
        }
      }
    )

    // Load BOQ items for this project for matching
    const { data: boqItems } = await supabase
      .from('boq_items')
      .select('id, description, chapter_name, item_code')
      .eq('project_id', projectId)

    function findBoqMatch(desc: string): { id: string; status: string; notes: string } | null {
      if (!boqItems?.length) return null
      const normDesc = normalizeText(desc)
      const descWords = normDesc.split(/\s+/).filter(w => w.length > 3)
      let bestScore = 0
      let bestItem: typeof boqItems[0] | null = null

      for (const item of boqItems) {
        const normItem = normalizeText(item.description ?? '')
        const normChapter = normalizeText(item.chapter_name ?? '')
        const matchWords = descWords.filter(w => normItem.includes(w) || normChapter.includes(w))
        let score = descWords.length ? matchWords.length / descWords.length : 0
        if (normChapter && descWords.some(w => normChapter.includes(w))) score += 0.2
        if (score > bestScore) { bestScore = score; bestItem = item }
      }

      if (!bestItem || bestScore < 0.35) return null
      return { id: bestItem.id, status: 'ok', notes: `Matched with score ${bestScore.toFixed(2)}` }
    }

    // Insert invoice
    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        project_id:     projectId,
        invoice_number: invoiceData.invoice_number ?? null,
        supplier:       invoiceData.supplier       ?? null,
        invoice_date:   invoiceData.invoice_date   ?? null,
        total_amount:   invoiceData.total_amount   ?? null,
        currency:       invoiceData.currency       ?? 'EUR',
        file_name:      file.name,
        status:         'processed',
      })
      .select('id')
      .single()
    if (invoiceError) throw invoiceError

    // Insert invoice items with BOQ matching
    const itemRows = invoiceData.items.map((item) => {
      const match = findBoqMatch(item.description ?? '')
      let matchStatus = 'not_in_boq'
      let matchNotes = 'No BOQ match found'
      let boqItemId: string | null = null
      if (match) {
        boqItemId = match.id
        matchStatus = 'ok'
        matchNotes = match.notes
      }
      return {
        invoice_id:   invoice.id,
        boq_item_id:  boqItemId,
        description:  item.description  ?? '',
        unit:         item.unit         ?? null,
        quantity:     item.quantity     ?? null,
        unit_price:   item.unit_price   ?? null,
        total_amount: item.total_amount ?? null,
        match_status: matchStatus,
        match_notes:  matchNotes,
      }
    })

    if (itemRows.length) {
      const { error: itemsError } = await supabase.from('invoice_items').insert(itemRows)
      if (itemsError) throw itemsError
    }

    const alertCount = itemRows.filter(r => r.match_status !== 'ok').length
    return NextResponse.json({ success: true, invoiceId: invoice.id, itemCount: itemRows.length, alertCount })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Invoice upload error: ${msg}` }, { status: 500 })
  }
}

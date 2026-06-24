import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isSupportedFile, parseFile } from '@/lib/file-parser'
import { claudeCreate } from '@/lib/claude'
import { sendAlertEmail } from '@/lib/email'

interface SubItem {
  description: string
  unit?: string
  quantity?: number
  unit_price?: number
  total_amount?: number
}

interface InvoiceItem {
  description: string
  unit?: string
  quantity?: number
  unit_price?: number
  total_amount?: number
  sub_items?: SubItem[]
}

interface InvoiceData {
  invoice_number?: string
  supplier?: string
  invoice_date?: string
  total_amount?: number
  currency?: string
  total_ejecucion_material?: number
  a_deducir?: number
  total_certificacion?: number
  items: InvoiceItem[]
}

interface BoqRow {
  id: string
  description: string | null
  chapter_name: string | null
  item_code: string | null
  quantity: number | null
}

function stripFences(text: string): string {
  return text.replace(/^```[\w]*\n?/m, '').replace(/```\s*$/m, '').trim()
}

function extractJsonObject(text: string): InvoiceData | null {
  const cleaned = stripFences(text)
  try {
    const parsed = JSON.parse(cleaned)
    if (parsed && Array.isArray(parsed.items)) return parsed
  } catch {}
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(cleaned.slice(start, end + 1))
      if (parsed && Array.isArray(parsed.items)) return parsed
    } catch {}
  }
  return null
}

function normalizeText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

function findBoqMatch(
  desc: string,
  boqItems: BoqRow[]
): { id: string; notes: string } | null {
  if (!boqItems.length) return null
  const normDesc = normalizeText(desc)
  const descWords = normDesc.split(/\s+/).filter(w => w.length > 3)
  let bestScore = 0
  let bestItem: BoqRow | null = null

  for (const item of boqItems) {
    const normItem = normalizeText(item.description ?? '')
    const normChapter = normalizeText(item.chapter_name ?? '')
    const matchWords = descWords.filter(w => normItem.includes(w) || normChapter.includes(w))
    let score = descWords.length ? matchWords.length / descWords.length : 0
    if (normChapter && descWords.some(w => normChapter.includes(w))) score += 0.2
    if (score > bestScore) { bestScore = score; bestItem = item }
  }

  if (!bestItem || bestScore < 0.35) return null
  return { id: bestItem.id, notes: `Matched with score ${bestScore.toFixed(2)}` }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    const projectId = formData.get('projectId') as string | null

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!projectId) return NextResponse.json({ error: 'No projectId provided' }, { status: 400 })
    if (!isSupportedFile(file.type, file.name)) {
      return NextResponse.json({ error: 'Unsupported file type. Please upload PDF, CSV, or Excel.' }, { status: 400 })
    }

    const buffer = Buffer.from(await file.arrayBuffer())
    const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
    const isPdf = ext === 'pdf' || file.type === 'application/pdf'

    // Build the message content — PDFs go in as base64 documents, others as parsed text
    const promptText = `Extract invoice/certification data from this document and return ONLY a raw JSON object with no markdown formatting.

This may be a Spanish construction "Certificación" (payment certificate). In that case extract:
- invoice_number = the certification number (e.g. "4" for "Certificación Nº 4")
- supplier = contractor company name
- invoice_date = date on the document (YYYY-MM-DD)
- total_amount = the NET amount due for THIS certificate only (TOTAL CERTIFICACIÓN SIN IVA, NOT the cumulative total)
- total_ejecucion_material = the "TOTAL EJECUCIÓN MATERIAL" amount (sum of all chapter totals before any deductions)
- a_deducir = the "A deducir certificación anterior" amount (previous certification deduction, positive number)
- total_certificacion = the "TOTAL CERTIFICACIÓN" amount after applying retention/guarantee deduction
- items = one entry per CAPÍTULO (chapter). Each chapter item must include:
  - description = full chapter name/title (e.g. "CAPÍTULO 1 - MOVIMIENTO DE TIERRAS")
  - total_amount = that chapter's total amount for this certification period
  - sub_items = array of every individual line item (partida) inside this chapter, each with:
    - description = line item description
    - unit = unit of measure (m², ml, ud, etc.) or null
    - quantity = quantity for this certification or null
    - unit_price = unit price or null
    - total_amount = line total or null

Return format:
{
  "invoice_number": "string or null",
  "supplier": "string or null",
  "invoice_date": "YYYY-MM-DD or null",
  "total_amount": number or null,
  "currency": "EUR",
  "total_ejecucion_material": number or null,
  "a_deducir": number or null,
  "total_certificacion": number or null,
  "items": [
    {
      "description": "string (full chapter name)",
      "unit": null,
      "quantity": null,
      "unit_price": null,
      "total_amount": number or null,
      "sub_items": [
        {
          "description": "string",
          "unit": "string or null",
          "quantity": number or null,
          "unit_price": number or null,
          "total_amount": number or null
        }
      ]
    }
  ]
}

Spanish terms: CAPÍTULO=chapter, partida=line item, TOTAL EJECUCIÓN MATERIAL=total_ejecucion_material, A deducir certificación anterior=a_deducir, TOTAL CERTIFICACIÓN=total_certificacion, Retención/Garantía=retention deduction.
Return ONLY the raw JSON object starting with {, no code blocks, no explanation.`

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let messageContent: any[]
    if (isPdf) {
      messageContent = [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
        { type: 'text', text: promptText },
      ]
    } else {
      const content = await parseFile(buffer, file.type, file.name)
      messageContent = [{ type: 'text', text: `${promptText}\n\nDocument:\n${content}` }]
    }

    const message = await claudeCreate({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      messages: [{ role: 'user', content: messageContent as any }]
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

    const [{ data: boqItems }, { data: project }, { data: existingInvoices }] = await Promise.all([
      supabase.from('boq_items').select('id, description, chapter_name, item_code, quantity').eq('project_id', projectId),
      supabase.from('projects').select('name, email_recipients').eq('id', projectId).single(),
      supabase.from('invoices').select('id, invoice_number').eq('project_id', projectId),
    ])

    const { data: invoice, error: invoiceError } = await supabase
      .from('invoices')
      .insert({
        project_id:               projectId,
        invoice_number:           invoiceData.invoice_number           ?? '9999',
        supplier:                 invoiceData.supplier                 ?? null,
        invoice_date:             invoiceData.invoice_date             ?? null,
        total_amount:             invoiceData.total_amount             ?? null,
        currency:                 invoiceData.currency                 ?? 'EUR',
        total_ejecucion_material: invoiceData.total_ejecucion_material ?? null,
        a_deducir:                invoiceData.a_deducir                ?? null,
        total_certificacion:      invoiceData.total_certificacion      ?? null,
        file_name:                file.name,
        status:                   'processed',
      })
      .select('id')
      .single()
    if (invoiceError) throw invoiceError

    // Check for duplicate invoice number
    const dupInvoice = (existingInvoices ?? []).find(
      i => i.id !== invoice.id && i.invoice_number === (invoiceData.invoice_number ?? '9999')
    )

    const itemRows = invoiceData.items.map((item) => {
      const match = findBoqMatch(item.description ?? '', boqItems ?? [])
      return {
        invoice_id:   invoice.id,
        boq_item_id:  match?.id ?? null,
        description:  item.description  ?? '',
        unit:         item.unit         ?? null,
        quantity:     item.quantity     ?? null,
        unit_price:   item.unit_price   ?? null,
        total_amount: item.total_amount ?? null,
        match_status: match ? 'ok' : 'not_in_boq',
        match_notes:  match ? match.notes : 'No BOQ match found',
        sub_items:    item.sub_items ?? null,
      }
    })

    if (itemRows.length) {
      const { error: itemsError } = await supabase.from('invoice_items').insert(itemRows)
      if (itemsError) throw itemsError
    }

    // Generate alerts: not_in_boq items + quantity overruns
    const boqQtyMap = new Map((boqItems ?? []).map(b => [b.id, b.quantity]))
    const matchedBoqIds = itemRows.filter(r => r.boq_item_id).map(r => r.boq_item_id as string)
    const emailAlerts: { description: string; details: string }[] = []
    const alertRows: { project_id: string; invoice_id: string; type: string; description: string }[] = []

    // Duplicate invoice number alert
    if (dupInvoice) {
      alertRows.push({
        project_id: projectId,
        invoice_id: invoice.id,
        type: 'duplicate_invoice',
        description: `Duplicate invoice number: ${invoiceData.invoice_number ?? '9999'} was already uploaded`,
      })
      emailAlerts.push({
        description: `Invoice #${invoiceData.invoice_number ?? '9999'}`,
        details: 'Duplicate invoice number — already exists in this project',
      })
    }

    // Not-in-BOQ alerts
    for (const row of itemRows) {
      if (row.match_status === 'not_in_boq') {
        alertRows.push({
          project_id: projectId,
          invoice_id: invoice.id,
          type: 'not_in_boq',
          description: `Not found in BOQ: ${row.description}`,
        })
        emailAlerts.push({ description: row.description, details: 'Item not found in BOQ' })
      }
    }

    // Quantity overrun alerts
    if (matchedBoqIds.length) {
      const { data: allInvIds } = await supabase.from('invoices').select('id').eq('project_id', projectId)
      const { data: accData } = await supabase
        .from('invoice_items')
        .select('boq_item_id, quantity')
        .in('boq_item_id', matchedBoqIds)
        .in('invoice_id', (allInvIds ?? []).map(i => i.id))

      const accMap = new Map<string, number>()
      for (const row of accData ?? []) {
        if (row.boq_item_id)
          accMap.set(row.boq_item_id, (accMap.get(row.boq_item_id) ?? 0) + (row.quantity ?? 0))
      }

      for (const row of itemRows) {
        if (!row.boq_item_id) continue
        const boqQty = boqQtyMap.get(row.boq_item_id)
        const accQty = accMap.get(row.boq_item_id) ?? 0
        if (boqQty != null && boqQty > 0 && accQty > boqQty) {
          const details = `Accumulated ${accQty.toLocaleString('es-ES')} > budget ${boqQty.toLocaleString('es-ES')}`
          alertRows.push({
            project_id: projectId,
            invoice_id: invoice.id,
            type: 'quantity_overrun',
            description: `Quantity overrun: ${row.description} — ${details}`,
          })
          emailAlerts.push({ description: row.description, details })
        }
      }
    }

    if (alertRows.length) {
      const { error: alertsError } = await supabase.from('alerts').insert(alertRows)
      if (alertsError) throw alertsError
      const recipients: string[] = (project as { email_recipients?: string[] } | null)?.email_recipients ?? []
      const projectName: string = (project as { name?: string } | null)?.name ?? projectId
      await sendAlertEmail(recipients, projectName, invoiceData.invoice_number ?? null, emailAlerts).catch(() => {})
    }

    const alertCount = alertRows.length
    return NextResponse.json({ success: true, invoiceId: invoice.id, itemCount: itemRows.length, alertCount })
  } catch (err) {
    const msg = err instanceof Error
      ? err.message
      : (err as { message?: string })?.message ?? JSON.stringify(err)
    return NextResponse.json({ error: `Invoice upload error: ${msg}` }, { status: 500 })
  }
}

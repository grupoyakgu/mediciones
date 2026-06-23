import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { parseFile } from '@/lib/file-parser'
import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

interface InvoiceLineRaw {
  description: string
  chapter_ref?: string | null
  quantity?: number | null
  unit_price?: number | null
  total_amount?: number | null
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
    return NextResponse.json({ error: 'File appears empty or unreadable.' }, { status: 422 })
  }

  let claudeResponse: string
  try {
    const response = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 8192,
      messages: [{
        role: 'user',
        content: `You are parsing a construction invoice, payment certificate, or "certificación de obra". The file may be in English or Spanish. Extract the data and return a single JSON object.

Spanish terminology:
- "Factura" / "Nº Factura" = invoice_number
- "Fecha" = invoice_date
- "Importe total" / "Total" / "Base imponible" = total_amount
- "Capítulo" / "Cap." = chapter_ref on the line item
- "Descripción" / "Concepto" = description
- "Cantidad" / "Medición" = quantity
- "Precio" / "P.U." = unit_price
- "Importe" / "Subtotal" = total_amount on the line item

Required format:
{
  "invoice_number": string | null,
  "invoice_date": "YYYY-MM-DD" | null,
  "total_amount": number | null,
  "items": [
    {
      "description": string,
      "chapter_ref": string | null,
      "quantity": number | null,
      "unit_price": number | null,
      "total_amount": number | null
    }
  ]
}

Rules:
- Keep descriptions in their original language.
- Numbers must be plain numbers — remove currency symbols and thousand separators (. or ,), keep decimal as a period.
- invoice_date in ISO format YYYY-MM-DD or null.
- Return ONLY a raw JSON object, no markdown, no code fences, no explanation.

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

  let invoiceData: { invoice_number?: string | null; invoice_date?: string | null; total_amount?: number | null; items: InvoiceLineRaw[] } | null = null
  try {
    const parsed = JSON.parse(jsonText)
    if (parsed && Array.isArray(parsed.items)) invoiceData = parsed
  } catch {
    const match = jsonText.match(/\{[\s\S]*/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0])
        if (parsed && Array.isArray(parsed.items)) invoiceData = parsed
      } catch { /* ignore */ }
    }
  }

  if (!invoiceData) {
    return NextResponse.json({
      error: `Could not parse Claude's response as JSON. First 300 chars: ${jsonText.slice(0, 300)}`
    }, { status: 422 })
  }

  const { data: boqItems } = await supabase
    .from('boq_items')
    .select('id, description, chapter_id, chapter_name, item_code, unit, quantity, unit_price, total_amount')

  const boq = boqItems ?? []

  const invoiceTotal = invoiceData.total_amount ??
    invoiceData.items.reduce((s, i) => s + (i.total_amount ?? 0), 0)

  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .insert({
      invoice_number: invoiceData.invoice_number ?? null,
      invoice_date: invoiceData.invoice_date ?? null,
      file_name: file.name,
      status: 'pending',
      total_amount: invoiceTotal,
      source: 'dashboard',
    })
    .select('id')
    .single()

  if (invErr || !invoice) {
    return NextResponse.json({ error: `DB error creating invoice: ${invErr?.message}` }, { status: 500 })
  }

  function normalize(s: string): string {
    return s.toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '')  // strip accents: é->e, ñ->n, etc.
      .replace(/[^a-z0-9]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  function matchBoq(desc: string, chapterRef: string | null | undefined) {
    if (!boq.length) return null
    const normDesc = normalize(desc)
    const normChapter = chapterRef ? normalize(chapterRef) : null

    // Exact description match
    const hit = boq.find(b => normalize(b.description) === normDesc)
    if (hit) return hit

    // Word overlap score
    const descWords = new Set(normDesc.split(' ').filter(w => w.length > 3))
    let best: typeof boq[0] | null = null
    let bestScore = 0
    for (const b of boq) {
      const bWords = normalize(b.description).split(' ').filter(w => w.length > 3)
      const overlap = bWords.filter(w => descWords.has(w)).length
      const score = overlap / Math.max(descWords.size, bWords.length, 1)
      const chapterBoost = normChapter && (
        normalize(b.chapter_id ?? '') === normChapter ||
        normalize(b.chapter_name ?? '').includes(normChapter)
      ) ? 0.2 : 0
      if (score + chapterBoost > bestScore) {
        bestScore = score + chapterBoost
        best = b
      }
    }
    return bestScore >= 0.35 ? best : null
  }

  let alertsCount = 0
  const lineRows = invoiceData.items
    .filter(item => item.description)
    .map(item => {
      const matched = matchBoq(item.description, item.chapter_ref)
      let matchStatus = 'not_in_boq'
      let boqQty: number | null = null
      let boqPrice: number | null = null
      let qtyDelta: number | null = null
      let priceDeltaPct: number | null = null

      if (matched) {
        boqQty = matched.quantity
        boqPrice = matched.unit_price
        const invQty = item.quantity ?? 0
        const invPrice = item.unit_price ?? 0
        const bQty = matched.quantity ?? 0
        const bPrice = matched.unit_price ?? 0

        qtyDelta = bQty > 0 ? invQty - bQty : null
        priceDeltaPct = bPrice > 0 ? ((invPrice - bPrice) / bPrice) * 100 : null

        const qtyOver = bQty > 0 && invQty > bQty * 1.05
        const priceOver = bPrice > 0 && invPrice > bPrice * 1.05

        if (qtyOver) matchStatus = 'warning_quantity'
        else if (priceOver) matchStatus = 'warning_price'
        else matchStatus = 'ok'

        if (matchStatus !== 'ok') alertsCount++
      } else {
        alertsCount++
      }

      return {
        invoice_id: invoice.id,
        description: item.description,
        chapter_ref: item.chapter_ref ?? null,
        quantity: item.quantity ?? null,
        unit_price: item.unit_price ?? null,
        total_amount: item.total_amount ?? null,
        boq_item_id: matched?.id ?? null,
        match_status: matchStatus,
        boq_quantity: boqQty,
        boq_unit_price: boqPrice,
        quantity_delta: qtyDelta,
        price_delta_pct: priceDeltaPct ? Math.round(priceDeltaPct * 100) / 100 : null,
      }
    })

  if (lineRows.length > 0) {
    const { error: lineErr } = await supabase.from('invoice_items').insert(lineRows)
    if (lineErr) {
      await supabase.from('invoices').delete().eq('id', invoice.id)
      return NextResponse.json({ error: `DB error inserting line items: ${lineErr.message}` }, { status: 500 })
    }
  }

  const finalStatus = alertsCount > 0 ? 'alerts' : 'ok'
  await supabase.from('invoices').update({ status: finalStatus, alerts_count: alertsCount }).eq('id', invoice.id)

  return NextResponse.json({
    ok: true,
    invoice_id: invoice.id,
    line_count: lineRows.length,
    alerts_count: alertsCount,
    status: finalStatus,
  })
}

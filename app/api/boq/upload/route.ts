import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import * as XLSX from 'xlsx'

interface BoqRow {
  chapter_id: string
  chapter_name: string
  item_code: string
  description: string
  unit: string
  quantity: number | null
  unit_price: number | null
  total_amount: number | null
  numbering_anomaly: boolean
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const s = String(v).replace(/,/g, '')
  const n = Number(s)
  return isNaN(n) ? null : n
}

function detectAnomaly(code: string, lastChapterCode: string): boolean {
  if (!code) return true
  if (!lastChapterCode) return false
  return !code.startsWith(lastChapterCode)
}

function parseXlsx(buffer: ArrayBuffer): BoqRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })

  const chapterNames = new Map<string, string>()
  const items: BoqRow[] = []
  let lastChapterCode = ''

  for (const row of rawRows) {
    if (!Array.isArray(row)) continue
    const code = String(row[0] ?? '').trim()
    const nat  = String(row[1] ?? '').trim()
    const unit = String(row[2] ?? '').trim()
    const desc = String(row[3] ?? '').trim()

    if (!code || !nat) continue

    if (nat === 'Capítulo' || nat === 'Capitulo') {
      chapterNames.set(code, desc)
      lastChapterCode = code
    } else if (nat === 'Partida') {
      const anomaly = detectAnomaly(code, lastChapterCode)
      items.push({
        chapter_id:        lastChapterCode,
        chapter_name:      chapterNames.get(lastChapterCode) ?? '',
        item_code:         code,
        description:       desc,
        unit,
        quantity:          toNum(row[4]),
        unit_price:        toNum(row[5]),
        total_amount:      toNum(row[6]),
        numbering_anomaly: anomaly,
      })
    }
  }

  return items
}

function parseCsv(text: string): BoqRow[] {
  const lines = text.split(/\r?\n/)
  const chapterNames = new Map<string, string>()
  const items: BoqRow[] = []
  let lastChapterCode = ''

  for (const line of lines) {
    const cols = line.split(',')
    const code = cols[0]?.trim() ?? ''
    const nat  = cols[1]?.trim() ?? ''
    const unit = cols[2]?.trim() ?? ''
    const desc = cols[3]?.trim() ?? ''

    if (!code || !nat) continue

    if (nat === 'Capítulo' || nat === 'Capitulo') {
      chapterNames.set(code, desc)
      lastChapterCode = code
    } else if (nat === 'Partida') {
      const anomaly = detectAnomaly(code, lastChapterCode)
      items.push({
        chapter_id:        lastChapterCode,
        chapter_name:      chapterNames.get(lastChapterCode) ?? '',
        item_code:         code,
        description:       desc,
        unit,
        quantity:          toNum(cols[4]?.replace(/"/g, '').replace(/,/g, '')),
        unit_price:        toNum(cols[5]?.replace(/"/g, '').replace(/,/g, '')),
        total_amount:      toNum(cols[6]?.replace(/"/g, '').replace(/,/g, '')),
        numbering_anomaly: anomaly,
      })
    }
  }

  return items
}

export const maxDuration = 60

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

    const filename = file.name.toLowerCase()
    let items: BoqRow[] = []

    if (filename.endsWith('.xlsx') || filename.endsWith('.xls')) {
      const buffer = await file.arrayBuffer()
      items = parseXlsx(buffer)
    } else {
      const text = await file.text()
      items = parseCsv(text)
    }

    if (items.length === 0) {
      return NextResponse.json({ error: 'No BOQ items found. Check that column B contains "Partida" or "Capítulo".' }, { status: 400 })
    }

    // Delete invoice_items referencing old BOQ items first (FK constraint)
    const { data: oldBoqIds } = await supabase.from('boq_items').select('id').eq('project_id', projectId)
    if (oldBoqIds && oldBoqIds.length > 0) {
      const ids = oldBoqIds.map((r: { id: string }) => r.id)
      const { error: iiErr } = await supabase.from('invoice_items').delete().in('boq_item_id', ids)
      if (iiErr) return NextResponse.json({ error: 'Failed to clear invoice item matches: ' + iiErr.message }, { status: 500 })
    }

    const { error: delError } = await supabase.from('boq_items').delete().eq('project_id', projectId)
    if (delError) return NextResponse.json({ error: 'Failed to clear existing BOQ: ' + delError.message }, { status: 500 })

    const BATCH = 100
    let imported = 0

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH).map((item) => ({
        project_id:   projectId,
        chapter_id:   item.chapter_id,
        chapter_name: item.chapter_name,
        item_code:    item.item_code,
        description:  item.description,
        unit:         item.unit,
        quantity:     item.quantity,
        unit_price:   item.unit_price,
        total_amount: item.total_amount,
      }))

      const { error } = await supabase.from('boq_items').insert(batch)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })

      imported += batch.length
    }

    // Raise critical alerts for items with numbering anomalies
    const anomalies = items.filter(i => i.numbering_anomaly)
    await supabase.from('alerts').delete().eq('project_id', projectId).eq('type', 'boq_numbering_anomaly')
    if (anomalies.length > 0) {
      const alertRows = anomalies.map(item => ({
        project_id:  projectId,
        invoice_id:  null,
        type:        'boq_numbering_anomaly',
        priority:    'critical',
        description: `BOQ item code does not match its chapter (kept in positional chapter "${item.chapter_name || item.chapter_id}"): ${item.item_code || '(no code)'} — ${item.description}`,
      }))
      const { error: alertErr } = await supabase.from('alerts').insert(alertRows)
      if (alertErr) console.error('[boq/upload] alert insert error:', alertErr.message)
    }

    const { error: updateError } = await supabase
      .from('projects')
      .update({ boq_file_name: file.name })
      .eq('id', projectId)

    if (updateError) return NextResponse.json({ error: 'BOQ imported but failed to save filename: ' + updateError.message }, { status: 500 })

    return NextResponse.json({ count: imported, anomalyCount: anomalies.length })
  } catch (err) {
    console.error('[boq/upload]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

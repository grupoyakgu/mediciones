import { NextRequest } from 'next/server'
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
}

function toNum(v: unknown): number | null {
  if (v == null || v === '') return null
  const n = Number(v)
  return isNaN(n) ? null : n
}

function parseXlsx(buffer: ArrayBuffer): BoqRow[] {
  const workbook = XLSX.read(buffer, { type: 'array' })
  const sheet = workbook.Sheets[workbook.SheetNames[0]]
  const rawRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true })

  const chapterNames = new Map<string, string>()
  const items: BoqRow[] = []

  for (const row of rawRows) {
    if (!Array.isArray(row)) continue
    const code = String(row[0] ?? '').trim()
    const nat  = String(row[1] ?? '').trim()
    const unit = String(row[2] ?? '').trim()
    const desc = String(row[3] ?? '').trim()

    if (!code || !nat) continue

    if (nat === 'Capítulo' || nat === 'Capitulo') {
      chapterNames.set(code, desc)
    } else if (nat === 'Partida') {
      const topChapter = code.split('.')[0]
      items.push({
        chapter_id: code,
        chapter_name: chapterNames.get(topChapter) ?? '',
        item_code: code,
        description: desc,
        unit,
        quantity: toNum(row[4]),
        unit_price: toNum(row[5]),
        total_amount: toNum(row[6]),
      })
    }
  }

  return items
}

function parseCsv(text: string): BoqRow[] {
  const lines = text.split(/\r?\n/)
  const chapterNames = new Map<string, string>()
  const items: BoqRow[] = []

  for (const line of lines) {
    const cols = line.split(',')
    const code = cols[0]?.trim() ?? ''
    const nat  = cols[1]?.trim() ?? ''
    const unit = cols[2]?.trim() ?? ''
    const desc = cols[3]?.trim() ?? ''

    if (!code || !nat) continue

    if (nat === 'Capítulo' || nat === 'Capitulo') {
      chapterNames.set(code, desc)
    } else if (nat === 'Partida') {
      const topChapter = code.split('.')[0]
      items.push({
        chapter_id: code,
        chapter_name: chapterNames.get(topChapter) ?? '',
        item_code: code,
        description: desc,
        unit,
        quantity: toNum(cols[4]?.replace(/"/g, '').replace(/,/g, '')),
        unit_price: toNum(cols[5]?.replace(/"/g, '').replace(/,/g, '')),
        total_amount: toNum(cols[6]?.replace(/"/g, '').replace(/,/g, '')),
      })
    }
  }

  return items
}

export async function POST(req: NextRequest) {
  const enc = new TextEncoder()

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) =>
        controller.enqueue(enc.encode(JSON.stringify(data) + '\n'))

      try {
        const formData = await req.formData()
        const file = formData.get('file') as File | null
        const projectId = formData.get('projectId') as string | null

        if (!file || !projectId) {
          send({ error: 'Missing file or projectId' })
          controller.close()
          return
        }

        const supabase = createClient(
          process.env.NEXT_PUBLIC_SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
        )

        // Parse file
        send({ phase: 'parsing' })
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
          send({ error: 'No BOQ items found. Check that column B contains "Partida" or "Capítulo".' })
          controller.close()
          return
        }

        send({ phase: 'importing', total: items.length })

        // Delete existing BOQ items
        await supabase.from('boq_items').delete().eq('project_id', projectId)

        // Insert in batches, streaming progress
        const BATCH = 50
        let imported = 0

        for (let i = 0; i < items.length; i += BATCH) {
          const batch = items.slice(i, i + BATCH).map((item) => ({
            project_id: projectId,
            chapter_id: item.chapter_id,
            chapter_name: item.chapter_name,
            item_code: item.item_code,
            description: item.description,
            unit: item.unit,
            quantity: item.quantity,
            unit_price: item.unit_price,
            total_amount: item.total_amount,
          }))

          const { error } = await supabase.from('boq_items').insert(batch)
          if (error) throw new Error(error.message)

          imported += batch.length
          send({ imported, total: items.length })
        }

        await supabase.from('projects').update({ boq_uploaded: true }).eq('id', projectId)
        send({ done: true, count: imported })
      } catch (err) {
        console.error('[boq/upload]', err)
        try {
          controller.enqueue(enc.encode(JSON.stringify({ error: String(err) }) + '\n'))
        } catch { /* stream already closed */ }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'application/x-ndjson',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { extractText } from 'unpdf'

export const maxDuration = 60

function toNum(v: string): number | null {
  const s = v.replace(/,/g, '')
  const n = Number(s)
  return isNaN(n) || s === '' ? null : n
}

function isTopLevelChapter(code: string): boolean {
  return /^\d+$/.test(code)
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'Missing file' }, { status: 400 })

    const buffer = await file.arrayBuffer()
    const { text } = await extractText(new Uint8Array(buffer), { mergePages: true })

    const lines = text.split(/\r?\n/)
    const chapterNames = new Map<string, string>()
    const items: Record<string, unknown>[] = []
    let lastChapterCode = ''

    for (const line of lines) {
      const cols = line.split(/\t|  +/).map(c => c.trim()).filter(c => c !== '')
      if (cols.length < 2) continue

      const code = cols[0] ?? ''
      const nat  = cols[1] ?? ''
      const unit = cols[2] ?? ''
      const desc = cols[3] ?? ''

      if (!code || !nat) continue

      if (nat === 'Capítulo' || nat === 'Capitulo') {
        chapterNames.set(code, desc)
        if (isTopLevelChapter(code)) lastChapterCode = code
      } else if (nat === 'Partida') {
        items.push({
          item_code:    code,
          chapter_id:   lastChapterCode,
          chapter_name: chapterNames.get(lastChapterCode) ?? '',
          description:  desc,
          unit,
          quantity:     toNum(cols[4] ?? ''),
          unit_price:   toNum(cols[5] ?? ''),
          total_amount: toNum(cols[6] ?? ''),
        })
      }
    }

    return NextResponse.json({ items })
  } catch (err) {
    console.error('[boq/parse]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

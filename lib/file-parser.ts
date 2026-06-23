import * as XLSX from 'xlsx'

const SUPPORTED_EXTENSIONS = ['pdf', 'csv', 'xlsx', 'xls']
const MAX_CONTENT_CHARS = 15000

export function isSupportedFile(_mimeType: string, fileName: string): boolean {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  return SUPPORTED_EXTENSIONS.includes(ext)
}

export async function parseFile(buffer: Buffer, mimeType: string, fileName: string): Promise<string> {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''

  if (ext === 'xlsx' || ext === 'xls' || mimeType.includes('excel') || mimeType.includes('spreadsheet')) {
    const workbook = XLSX.read(buffer, { type: 'buffer' })
    const text = workbook.SheetNames.map((name) => {
      const csv = XLSX.utils.sheet_to_csv(workbook.Sheets[name])
      return `=== Sheet: ${name} ===\n${csv}`
    }).join('\n\n').trim()
    return text.slice(0, MAX_CONTENT_CHARS)
  }

  if (ext === 'csv' || mimeType.includes('csv') || mimeType === 'text/plain') {
    return buffer.toString('utf-8').trim().slice(0, MAX_CONTENT_CHARS)
  }

  if (ext === 'pdf' || mimeType === 'application/pdf') {
    const raw = buffer.toString('latin1')
    const chunks: string[] = []
    const regex = /BT[\s\S]*?ET/g
    let m
    while ((m = regex.exec(raw)) !== null && chunks.join('').length < MAX_CONTENT_CHARS) {
      const inner = m[0].replace(/\/F\d+\s+[\d.]+\s+Tf/g, '').replace(/Td|Tm|Tf|TJ|Tj|T\*/g, ' ')
      const strings = inner.match(/\(([^)]{2,})\)/g) ?? []
      for (const s of strings) chunks.push(s.slice(1, -1))
    }
    const text = chunks.join(' ').replace(/\\n/g, '\n').replace(/\\/g, '').trim()
    if (text.length > 100) return text.slice(0, MAX_CONTENT_CHARS)
    return '[PDF received but text could not be extracted. Please try CSV or Excel instead.]'
  }

  throw new Error(`Unsupported format: ${mimeType} (${fileName})`)
}

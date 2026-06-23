import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { isSupportedFile, parseFileContent } from '@/lib/file-parser'
import { claudeCreate } from '@/lib/claude'

function extractJsonArray(text: string): Record<string, unknown>[] | null {
  const start = text.indexOf('[')
  if (start === -1) return null
  try {
    const parsed = JSON.parse(text)
    if (Array.isArray(parsed)) return parsed
  } catch {}
  const end = text.lastIndexOf(']')
  if (end > start) {
    try {
      const parsed = JSON.parse(text.slice(start, end + 1))
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  const candidate = text.slice(start)
  const lastObj = candidate.lastIndexOf('},')
  const closeAt = lastObj !== -1 ? lastObj + 1 : candidate.lastIndexOf('}')
  if (closeAt > 0) {
    try {
      const parsed = JSON.parse(candidate.slice(0, closeAt + 1) + ']')
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  return null
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
        content: `Extract all BOQ (Bill of Quantities / Presupuesto de Obra) line items from this document and return ONLY a JSON array.

Column mapping (Spanish → field name):
- Capítulo / Cap. / Título → chapter_id and chapter_name
- Partida / Cod. / Código → item_code
- Descripción / Concepto / Nombre → description
- Ud / Uds / Unidad / Medida → unit
- Medición / Cantidad / Nº → quantity (number)
- Precio / P.U. / Precio Unitario → unit_price (number)
- Importe / Total / Presupuesto → total_amount (number)

Rules:
- Return ONLY a JSON array, no other text before or after
- Each element: { "chapter_id", "chapter_name", "item_code", "description", "unit", "quantity", "unit_price", "total_amount" }
- Use null for missing numeric fields, empty string "" for missing text
- Numbers must be plain numbers (no currency symbols, no thousands separators)
- Chapter/section header rows: set item_code to the chapter code, description to the chapter title, numeric fields to null

Document content:
${content}`
      }]
    })

    const rawText = message.content[0].type === 'text' ? message.content[0].text : ''
    const items = extractJsonArray(rawText)
    if (!items) {
      return NextResponse.json(
        { error: `Could not find a JSON array in Claude's response. First 300 chars: ${rawText.slice(0, 300)}` },
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

    // Delete old BOQ items for this project
    const { error: deleteError } = await supabase
      .from('boq_items')
      .delete()
      .eq('project_id', projectId)
    if (deleteError) throw deleteError

    // Insert new items
    const rows = items.map((item) => ({
      project_id: projectId,
      chapter_id:   String(item.chapter_id   ?? ''),
      chapter_name: String(item.chapter_name ?? ''),
      item_code:    String(item.item_code    ?? ''),
      description:  String(item.description  ?? ''),
      unit:         item.unit        != null ? String(item.unit) : null,
      quantity:     item.quantity    != null ? Number(item.quantity)   : null,
      unit_price:   item.unit_price  != null ? Number(item.unit_price) : null,
      total_amount: item.total_amount != null ? Number(item.total_amount) : null,
    }))

    const { error: insertError } = await supabase.from('boq_items').insert(rows)
    if (insertError) throw insertError

    // Update project metadata
    const { error: updateError } = await supabase
      .from('projects')
      .update({ boq_file_name: file.name, boq_uploaded_at: new Date().toISOString() })
      .eq('id', projectId)
    if (updateError) throw updateError

    return NextResponse.json({ success: true, itemCount: rows.length })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: `Claude API error: ${msg}` }, { status: 500 })
  }
}

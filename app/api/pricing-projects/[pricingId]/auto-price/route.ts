import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { claudeCreate } from '@/lib/claude'

function makeSupabase() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (toSet: { name: string; value: string; options: Parameters<typeof cookieStore.set>[2] }[]) => {
          toSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options))
        },
      },
    }
  )
}

const SYSTEM_PROMPT = `Eres un profesional de la construcción con amplia experiencia en obras en Sevilla, España.
Tu tarea es proporcionar precios de mercado actuales para partidas de obra.
Responde SIEMPRE con un JSON válido y nada más, en este formato exacto:
{"unit_price": <número decimal>, "notes": "<breve justificación en español>"}
El precio debe ser el precio unitario en euros (€) sin IVA, típico del mercado de Sevilla para 2024-2025.
Si no puedes estimar un precio razonable, usa null: {"unit_price": null, "notes": "<motivo>"}`

async function getPriceFromClaude(
  item_code: string,
  description: string,
  unit: string,
  chapter_name: string,
): Promise<{ unit_price: number | null; notes: string }> {
  const msg = await claudeCreate({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Capítulo: ${chapter_name}
Código: ${item_code}
Descripción: ${description}
Unidad: ${unit}

¿Cuál es el precio unitario de mercado en Sevilla para esta partida?`,
      },
    ],
  })

  const raw = (msg.content[0] as { type: string; text: string }).text.trim()
  // Extract JSON even if Claude adds surrounding text
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { unit_price: null, notes: 'No se pudo parsear respuesta' }
  try {
    const parsed = JSON.parse(match[0])
    return {
      unit_price: typeof parsed.unit_price === 'number' ? parsed.unit_price : null,
      notes: parsed.notes ?? '',
    }
  } catch {
    return { unit_price: null, notes: 'Error al parsear JSON' }
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: { pricingId: string } }
) {
  const { chapter_id } = (await req.json()) as { chapter_id: string }

  const supabase = makeSupabase()
  const { data, error } = await supabase
    .from('pricing_projects')
    .select('results')
    .eq('id', params.pricingId)
    .single()

  if (error || !data?.results) {
    return NextResponse.json({ error: 'Project not found or no results' }, { status: 404 })
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chapters: any[] = data.results

  // Stream progress back via Server-Sent Events
  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      function send(payload: object) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }

      try {
        let totalUpdated = 0

        for (const ch of chapters) {
          if (chapter_id !== 'all' && ch.id !== chapter_id) continue

          for (const item of ch.items) {
            if (item.excluded) continue
            if ((item.matchScore ?? 100) > 50) continue
            // Already has a manual price — skip
            if (item.manualUnitPrice && item.manualUnitPrice !== '') continue

            send({ type: 'progress', item_code: item.item_code, description: item.description })

            const { unit_price, notes } = await getPriceFromClaude(
              item.item_code,
              item.description,
              item.unit,
              ch.name,
            )

            if (unit_price !== null) {
              item.manualUnitPrice = String(unit_price)
              item.effectiveUnitPrice = unit_price
              item.effectiveTotal =
                item.quantity != null ? unit_price * item.quantity : null
              item.autoPriced = true
              totalUpdated++
            }

            send({
              type: 'item_done',
              item_code: item.item_code,
              unit_price,
              notes,
              chapter_id: ch.id,
            })
          }

          // Recompute chapter subtotal
          ch.subtotal = ch.items
            .filter((i: { excluded: boolean }) => !i.excluded)
            .reduce((s: number, i: { effectiveTotal: number | null }) => s + (i.effectiveTotal ?? 0), 0)
        }

        // Save updated results to DB
        const { error: saveErr } = await supabase
          .from('pricing_projects')
          .update({ results: chapters, updated_at: new Date().toISOString() })
          .eq('id', params.pricingId)

        if (saveErr) {
          send({ type: 'error', message: saveErr.message })
        } else {
          send({ type: 'done', total_updated: totalUpdated, results: chapters })
        }
      } catch (e) {
        send({ type: 'error', message: String(e) })
      } finally {
        controller.close()
      }
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}

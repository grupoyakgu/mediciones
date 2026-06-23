import Anthropic from '@anthropic-ai/sdk'

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const RETRYABLE_STATUSES = new Set([529, 503, 502, 500])
const MAX_ATTEMPTS = 4

export async function claudeCreate(
  params: Parameters<typeof anthropic.messages.create>[0]
): Promise<Anthropic.Message> {
  let lastError: unknown
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      return await anthropic.messages.create(params)
    } catch (e) {
      lastError = e
      const status = (e as { status?: number }).status
      if (!status || !RETRYABLE_STATUSES.has(status)) throw e
      const delay = Math.min(2000 * 2 ** attempt, 16000)
      await new Promise(r => setTimeout(r, delay))
    }
  }
  throw lastError
}

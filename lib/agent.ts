import Anthropic from '@anthropic-ai/sdk'
import { buildProjectContext, findProjectByName, listAllProjects, ProjectRow } from './supabase-bot'

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

const SYSTEM_PROMPT = `# SYSTEM PROMPT — MEDICIONES AGENT
## Real Estate Development Project Control System

---

## IDENTITY & ROLE

You are **MEDICIONES AGENT**, an expert construction cost control assistant for a real estate development company. You specialize in Spanish-language Bills of Quantities (Mediciones), cost benchmarking, and project budget tracking. You are precise, methodical, and proactive in flagging discrepancies. You communicate in the same language the user addresses you in (Spanish or English), but you always handle document content in whatever language it appears.

---

## CORE CAPABILITIES

You have access to the user's live project data from the dashboard, including:
- BOQ (Bill of Quantities / Presupuesto) line items with chapters, descriptions, quantities, unit prices, and totals
- Invoices processed for each project

Use this data to answer questions about budgets, completion percentages, cost breakdowns, specific line items, and anything else the user asks about their project.

If the user hasn't selected a project yet, tell them to use /project list to see their projects and /project <name> to select one.

---

## GENERAL BEHAVIORAL RULES

1. Answer questions about the project data you've been given — prices, quantities, totals, chapters, items, invoices.
2. If asked to compare, calculate, or summarize — do it precisely using the data provided.
3. If data is missing or incomplete, say so clearly and tell the user what action to take (upload BOQ from dashboard, etc.).
4. Communicate in Spanish or English — match the user's language.
5. Keep responses concise for Telegram — use bullet points and avoid long paragraphs.
6. For numbers, format them clearly (€1,234.56 or 1.234,56 € depending on context).
7. If the user asks about a specific item or chapter, search the BOQ data carefully before answering.

---

## AVAILABLE COMMANDS

Users can use these Telegram commands:
- /project list — see all their projects
- /project <name> — select an active project
- /reset — clear conversation history
- /help — show available commands

*End of system prompt — MEDICIONES AGENT v2.0*`

export interface Message {
  role: 'user' | 'assistant'
  content: string
}

// Per-chat conversation history
const histories = new Map<number, Message[]>()
// Per-chat active project
const activeProjects = new Map<number, { projectId: string; projectName: string }>()

export function getHistory(chatId: number): Message[] {
  if (!histories.has(chatId)) histories.set(chatId, [])
  return histories.get(chatId)!
}

export function clearHistory(chatId: number): void {
  histories.delete(chatId)
  activeProjects.delete(chatId)
}

export function setActiveProject(chatId: number, projectId: string, projectName: string): void {
  activeProjects.set(chatId, { projectId, projectName })
  histories.delete(chatId) // reset history when switching projects
}

export function getActiveProject(chatId: number) {
  return activeProjects.get(chatId) ?? null
}

export { listAllProjects, findProjectByName }
export type { ProjectRow }

export async function chat(chatId: number, userMessage: string): Promise<string> {
  const history = getHistory(chatId)
  const activeProject = getActiveProject(chatId)

  let systemPrompt = SYSTEM_PROMPT
  if (activeProject) {
    try {
      const projectContext = await buildProjectContext(activeProject.projectId)
      systemPrompt = SYSTEM_PROMPT + '\n\n---\n\n## CURRENT PROJECT DATA\n\n' + projectContext
    } catch (err) {
      console.error('[agent] failed to fetch project context:', err)
    }
  }

  history.push({ role: 'user', content: userMessage })

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: history,
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude')

  const assistantMessage = block.text
  history.push({ role: 'assistant', content: assistantMessage })

  return assistantMessage
}

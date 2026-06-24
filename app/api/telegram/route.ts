import { NextRequest, NextResponse } from 'next/server'
import {
  chat,
  clearHistory,
  getActiveProject,
  setActiveProject,
  listAllProjects,
  findProjectByName,
} from '@/lib/agent'

export const maxDuration = 60

async function handleMessage(chatId: number, text: string): Promise<string> {
  const lower = text.trim().toLowerCase()

  if (lower === '/reset') {
    clearHistory(chatId)
    return '🔄 Conversation and active project cleared. Use /project list to get started.'
  }

  if (lower === '/help' || lower === '/start') {
    return [
      '👋 MEDICIONES AGENT',
      '',
      'I can answer questions about your construction projects — BOQ items, budgets, invoices, and more.',
      '',
      'Commands:',
      '/project list — see your projects',
      '/project <name> — select a project',
      '/reset — clear conversation',
      '/help — show this message',
      '',
      'To get started, use /project list',
    ].join('\n')
  }

  if (lower === '/project list' || lower === '/projects') {
    const projects = await listAllProjects()
    if (projects.length === 0) {
      return '📂 No projects found. Create a project from the dashboard first.'
    }
    const lines = projects.map((p, i) => {
      const hasBOQ = p.boq_file_name ? '✅' : '⬜'
      return `${i + 1}. ${hasBOQ} ${p.name}`
    })
    return [
      `📂 Your projects (${projects.length}):`,
      '',
      ...lines,
      '',
      '✅ = BOQ uploaded  ⬜ = no BOQ yet',
      '',
      'Select one with: /project <name>',
    ].join('\n')
  }

  if (lower.startsWith('/project ')) {
    const nameQuery = text.slice('/project '.length).trim()
    if (!nameQuery) {
      return 'Usage: /project <name>  or  /project list'
    }
    const project = await findProjectByName(nameQuery)
    if (!project) {
      return `❌ No project found matching "${nameQuery}".\n\nUse /project list to see all projects.`
    }
    setActiveProject(chatId, project.id, project.name)
    const hasBOQ = project.boq_file_name
      ? `✅ BOQ loaded: ${project.boq_file_name}`
      : '⬜ No BOQ uploaded yet — upload one from the dashboard to unlock Q&A'
    return `✅ Active project set to: ${project.name}\n${hasBOQ}\n\nYou can now ask me anything about this project!`
  }

  const activeProject = getActiveProject(chatId)
  if (!activeProject) {
    return 'ℹ️ No project selected.\n\nUse /project list to see your projects and /project <name> to select one.'
  }

  return chat(chatId, text)
}

// Reply via webhook response body — no outbound HTTP call needed.
// Telegram executes the method directly from our response.
function telegramReply(chatId: number, text: string): NextResponse {
  const MAX = 4096
  const truncated = text.length > MAX ? text.slice(0, MAX - 3) + '...' : text
  return NextResponse.json({ method: 'sendMessage', chat_id: chatId, text: truncated })
}

export async function POST(req: NextRequest) {
  let chatId: number | undefined

  try {
    const body = await req.json()
    const message = body?.message
    chatId = message?.chat?.id
    const text: string | undefined = message?.text

    if (!chatId || !text) return NextResponse.json({ ok: true })

    const reply = await handleMessage(chatId, text)
    return telegramReply(chatId, reply)
  } catch (err: unknown) {
    console.error('[telegram] error:', err)
    if (chatId) {
      const msg = err instanceof Error ? err.message : String(err)
      const userMsg = msg.includes('credit balance is too low')
        ? '⚠️ The AI service is temporarily unavailable (billing issue). Please try again later.'
        : msg.includes('timed out') || msg.includes('ETIMEDOUT')
        ? '⏱ Request timed out. Try asking a simpler question or select a smaller project.'
        : '❌ Something went wrong. Please try again.'
      return telegramReply(chatId, userMsg)
    }
    return NextResponse.json({ ok: true })
  }
}

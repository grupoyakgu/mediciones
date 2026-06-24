import { NextRequest, NextResponse } from 'next/server'
import {
  chat,
  clearHistory,
  getActiveProject,
  setActiveProject,
  listAllProjects,
  findProjectByName,
} from '@/lib/agent'
import { TelegramClient } from '@/lib/telegram'

async function handleMessage(chatId: number, text: string): Promise<string> {
  const lower = text.trim().toLowerCase()

  // /reset — clear history and active project
  if (lower === '/reset') {
    clearHistory(chatId)
    return '🔄 Conversation and active project cleared. Use /project list to get started.'
  }

  // /help
  if (lower === '/help' || lower === '/start') {
    return [
      '👋 *MEDICIONES AGENT*',
      '',
      'I can answer questions about your construction projects — BOQ items, budgets, invoices, and more.',
      '',
      '*Commands:*',
      '/project list — see your projects',
      '/project <name> — select a project',
      '/reset — clear conversation',
      '/help — show this message',
      '',
      'To get started, use /project list',
    ].join('\n')
  }

  // /project list
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
      `📂 *Your projects* (${projects.length}):`,
      '',
      ...lines,
      '',
      '✅ = BOQ uploaded  ⬜ = no BOQ yet',
      '',
      'Select one with: /project <name>',
    ].join('\n')
  }

  // /project <name>
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
    return `✅ Active project set to: *${project.name}*\n${hasBOQ}\n\nYou can now ask me anything about this project!`
  }

  // For all other messages, check if a project is active
  const activeProject = getActiveProject(chatId)
  if (!activeProject) {
    return 'ℹ️ No project selected.\n\nUse /project list to see your projects and /project <name> to select one.'
  }

  // Regular Q&A — pass to Claude with project context
  return chat(chatId, text)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const message = body?.message
    const chatId: number | undefined = message?.chat?.id
    const text: string | undefined = message?.text

    if (chatId && text) {
      const telegram = new TelegramClient()
      handleMessage(chatId, text)
        .then((reply) => telegram.sendMessage(chatId, reply))
        .catch((err) => console.error(`[telegram] failed for chat ${chatId}:`, err))
    }
  } catch (err) {
    console.error('[telegram] failed to parse request:', err)
  }

  return NextResponse.json({ ok: true })
}

import { NextRequest, NextResponse } from 'next/server';
import { chat, clearHistory, setActiveProject, getActiveProject, listAllProjects, findProjectByName } from '@/lib/agent';
import { TelegramClient } from '@/lib/telegram';

export async function POST(req: NextRequest) {
  const telegram = new TelegramClient();
  try {
    const body = await req.json();
    const message = body?.message;
    const chatId: number | undefined = message?.chat?.id;
    const text: string | undefined = message?.text?.trim();

    if (!chatId || !text) return NextResponse.json({ ok: true });

    if (text === '/start' || text === '/help') {
      await telegram.sendMessage(chatId,
        `👋 MEDICIONES AGENT\n\nCommands:\n/project list — list all projects\n/project <name> — select a project\n/reset — clear conversation\n\nOnce a project is selected, ask me anything about its BOQ or invoices!`
      );
      return NextResponse.json({ ok: true });
    }

    if (text === '/reset') {
      clearHistory(chatId);
      await telegram.sendMessage(chatId, '🔄 Conversation reset. No active project.');
      return NextResponse.json({ ok: true });
    }

    if (text === '/project list') {
      const projects = await listAllProjects();
      if (projects.length === 0) {
        await telegram.sendMessage(chatId, 'No projects found.');
      } else {
        const list = projects.map((p) => `• ${p.name}`).join('\n');
        await telegram.sendMessage(chatId, `📁 Projects:\n${list}\n\nUse /project <name> to select one.`);
      }
      return NextResponse.json({ ok: true });
    }

    if (text.startsWith('/project ')) {
      const name = text.slice('/project '.length).trim();
      const project = await findProjectByName(name);
      if (!project) {
        await telegram.sendMessage(chatId, `❌ No project found matching "${name}". Use /project list to see all projects.`);
      } else {
        setActiveProject(chatId, project);
        await telegram.sendMessage(chatId, `✅ Active project set to: ${project.name}\n\nYou can now ask me questions about this project's BOQ, budget, and invoices.`);
      }
      return NextResponse.json({ ok: true });
    }

    const active = getActiveProject(chatId);
    if (!active && !text.startsWith('/')) {
      await telegram.sendMessage(chatId, `No project selected. Use /project list to see projects, then /project <name> to select one.`);
      return NextResponse.json({ ok: true });
    }

    const reply = await chat(chatId, text);
    await telegram.sendMessage(chatId, reply);
  } catch (err) {
    console.error('[telegram] error:', err);
  }

  return NextResponse.json({ ok: true });
}

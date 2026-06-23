import Anthropic from '@anthropic-ai/sdk';
import { buildProjectContext, findProjectByName, listAllProjects } from './supabase-bot';

export { listAllProjects, findProjectByName };

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const BASE_SYSTEM_PROMPT = `# SYSTEM PROMPT — MEDICIONES AGENT
## Real Estate Development Project Control System

You are **MEDICIONES AGENT**, an expert construction cost control assistant for a real estate development company. You specialize in Spanish-language Bills of Quantities (Mediciones), cost benchmarking, and project budget tracking. You are precise, methodical, and proactive in flagging discrepancies. You communicate in the same language the user addresses you in (Spanish or English), but you always handle document content in whatever language it appears.

You help users track project progress, answer questions about BOQ items, invoices, budget consumption, and cost overruns.`;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const histories = new Map<number, Message[]>();
const activeProjects = new Map<number, { id: string; name: string }>();

export function getHistory(chatId: number): Message[] {
  if (!histories.has(chatId)) histories.set(chatId, []);
  return histories.get(chatId)!;
}

export function clearHistory(chatId: number): void {
  histories.delete(chatId);
  activeProjects.delete(chatId);
}

export function setActiveProject(chatId: number, project: { id: string; name: string }): void {
  activeProjects.set(chatId, project);
}

export function getActiveProject(chatId: number): { id: string; name: string } | undefined {
  return activeProjects.get(chatId);
}

export async function chat(chatId: number, userMessage: string): Promise<string> {
  const history = getHistory(chatId);
  history.push({ role: 'user', content: userMessage });

  const project = getActiveProject(chatId);
  let systemPrompt = BASE_SYSTEM_PROMPT;

  if (project) {
    const context = await buildProjectContext(project.id);
    systemPrompt += `\n\n## ACTIVE PROJECT: ${project.name}\n\n${context}`;
  } else {
    systemPrompt += `\n\nNo project is currently selected. The user can select a project with /project <name>.`;
  }

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: systemPrompt,
    messages: history,
  });

  const block = response.content[0];
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude');

  const assistantMessage = block.text;
  history.push({ role: 'assistant', content: assistantMessage });

  return assistantMessage;
}

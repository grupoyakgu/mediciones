# Telegram Task Manager Agent

## Stack
- Next.js 14 (App Router)
- Vercel serverless functions
- Telegram Bot API (webhook mode)
- Anthropic SDK (claude-sonnet-4-6)

## Project Structure
- /app/api/telegram/route.ts   → webhook handler
- /lib/agent.ts                → Claude agent logic
- /lib/tasks.ts                → task CRUD helpers
- /lib/telegram.ts             → Telegram API wrapper

## Environment Variables needed
- TELEGRAM_BOT_TOKEN
- ANTHROPIC_API_KEY

## Rules
- Always use TypeScript
- Always handle errors gracefully
- Keep functions small and single-purpose

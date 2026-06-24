import { NextRequest, NextResponse } from 'next/server'
import { sendAlertEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const { email } = await req.json()
  if (!email) return NextResponse.json({ error: 'email required' }, { status: 400 })
  try {
    await sendAlertEmail(
      [email],
      'Test Project',
      'TEST-001',
      [{ description: 'This is a test alert from Mediciones', details: 'email_test' }]
    )
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

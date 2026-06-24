import { Resend } from 'resend'

const FROM = process.env.RESEND_FROM_EMAIL ?? 'alerts@mediciones.app'

function getResend() {
  return new Resend(process.env.RESEND_API_KEY)
}

export async function sendAlertEmail(
  recipients: string[],
  projectName: string,
  invoiceNumber: string | null,
  alerts: { description: string; details: string }[]
) {
  if (!recipients.length || !process.env.RESEND_API_KEY) return

  const rows = alerts
    .map(a => `<tr><td style="padding:6px 12px;border-bottom:1px solid #f1f5f9">${a.description}</td><td style="padding:6px 12px;border-bottom:1px solid #f1f5f9;color:#dc2626">${a.details}</td></tr>`)
    .join('')

  await getResend().emails.send({
    from: FROM,
    to: recipients,
    subject: `⚠ Budget alert — ${projectName} · Invoice ${invoiceNumber ?? '—'}`,
    html: `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <h2 style="color:#0f172a">Budget overrun detected</h2>
        <p style="color:#475569">Project: <strong>${projectName}</strong> · Invoice: <strong>${invoiceNumber ?? '—'}</strong></p>
        <table style="width:100%;border-collapse:collapse;margin-top:16px">
          <thead><tr style="background:#f8fafc">
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Alert</th>
            <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;text-transform:uppercase">Type</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <p style="margin-top:24px;font-size:12px;color:#94a3b8">Go to your dashboard to acknowledge these alerts.</p>
      </div>
    `,
  })
}

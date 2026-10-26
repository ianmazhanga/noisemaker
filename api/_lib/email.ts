/**
 * Optional email alerts for team members who turn them on in Notifications → Preferences.
 * Sent with Resend (resend.com).
 *
 * Environment variables: RESEND_API_KEY, NOTIFY_FROM_EMAIL (e.g. "Noisemakers <alerts@noisemakersnews.com>",
 * on a domain verified in Resend). Without them, alerts stay in the dashboard only.
 */
type F = typeof fetch

export const emailConfigured = () => Boolean(process.env.RESEND_API_KEY && process.env.NOTIFY_FROM_EMAIL)

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function sendAlertEmail(to: string, items: { title: string; link: string }[], site: string, f: F = fetch) {
  const list = items.map((i) => `<li style="margin:0 0 8px"><a href="${esc(site + i.link)}">${esc(i.title)}</a></li>`).join('')
  const res = await f('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: process.env.NOTIFY_FROM_EMAIL,
      to: [to],
      subject: items.length === 1 ? `Noisemakers: ${items[0].title}`.slice(0, 120) : `Noisemakers: ${items.length} new notifications`,
      html: `<p style="font:16px Arial,sans-serif">New in the Noisemakers dashboard:</p><ul style="font:16px Arial,sans-serif">${list}</ul><p style="font:13px Arial,sans-serif;color:#5b5954">Change these emails in the dashboard under Notifications → Preferences.</p>`,
      text: `New in the Noisemakers dashboard:\n\n${items.map((i) => `- ${i.title}: ${site}${i.link}`).join('\n')}`,
    }),
    signal: AbortSignal.timeout(15_000),
  })
  if (!res.ok) throw new Error(`Resend ${res.status}`)
}

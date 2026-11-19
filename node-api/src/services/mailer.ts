// Sends the sign-in code by email. Configure ONE provider in node-api/.env:
//   BREVO_API_KEY=…  MAIL_FROM=you@yourdomain.com      (Brevo: free 300/day; verify the sender address once)
//   RESEND_API_KEY=… MAIL_FROM=login@yourdomain.com    (Resend: needs a verified domain to email other people)
// With neither set (local development) the code is printed in the node-api terminal instead.
import axios from 'axios'

export const mailConfigured = !!(process.env.BREVO_API_KEY || process.env.RESEND_API_KEY)

export async function sendLoginCode(to: string, code: string) {
  const subject = `${code} is your TrojanScout sign-in code`
  const text = `Your TrojanScout sign-in code is ${code}. It expires in 10 minutes.\n\nIf you didn't try to sign in, ignore this email.`
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;color:#1f2937"><p>Your TrojanScout sign-in code is</p><p style="font-size:30px;font-weight:800;letter-spacing:6px;color:#990000">${code}</p><p style="color:#6b7280">It expires in 10 minutes. If you didn't try to sign in, ignore this email.</p></div>`
  const from = process.env.MAIL_FROM ?? ''
  if (process.env.BREVO_API_KEY) {
    await axios.post('https://api.brevo.com/v3/smtp/email', { sender: { email: from, name: 'TrojanScout' }, to: [{ email: to }], subject, textContent: text, htmlContent: html },
      { headers: { 'api-key': process.env.BREVO_API_KEY, 'Content-Type': 'application/json' }, timeout: 10000 })
  } else if (process.env.RESEND_API_KEY) {
    await axios.post('https://api.resend.com/emails', { from: `TrojanScout <${from}>`, to: [to], subject, text, html },
      { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` }, timeout: 10000 })
  } else {
    console.log(`\n  ✉️  [dev] TrojanScout sign-in code for ${to}: ${code}  (set BREVO_API_KEY or RESEND_API_KEY to email it)\n`)
  }
}

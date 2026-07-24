type EmailMessage = {
  to: string
  subject: string
  html: string
  text: string
  tags?: Array<{ name: string; value: string }>
}

type EmailBatchResult = {
  ok: boolean
  configured: boolean
  sent: number
  error?: string
}

export type RegistrationEmailRecipient = {
  email: string
  username: string
}

const RESEND_API_URL = 'https://api.resend.com/emails/batch'

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#039;')

const emailFrame = (content: string) => `
<!doctype html>
<html lang="it">
  <body style="margin:0;background:#e8f4f5;font-family:Arial,Helvetica,sans-serif;color:#102a36">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#e8f4f5;padding:28px 12px">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:580px;background:#ffffff;border:1px solid #c9e2e5;border-radius:18px;overflow:hidden">
            <tr>
              <td style="background:#123f49;padding:24px;text-align:center">
                <div style="font-size:30px;font-weight:900;color:#ffffff;letter-spacing:2px">OPV</div>
                <div style="margin-top:5px;font-size:12px;font-weight:700;color:#8de7ee">ONE PIECE VAULT</div>
              </td>
            </tr>
            <tr>
              <td style="padding:30px 28px">${content}</td>
            </tr>
            <tr>
              <td style="padding:18px 28px;background:#f3f8f9;font-size:12px;line-height:18px;color:#60757e;text-align:center">
                Email automatica di One Piece Vault.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`

const welcomeMessage = ({ email, username }: RegistrationEmailRecipient): EmailMessage => {
  const safeName = escapeHtml(username || 'nuovo giocatore')
  const content = `
    <h1 style="margin:0;font-size:27px;line-height:34px;color:#123f49">Benvenuto, ${safeName}!</h1>
    <p style="margin:18px 0 0;font-size:16px;line-height:25px;color:#415d67">
      Il tuo account su <strong>One Piece Vault</strong> e pronto.
    </p>
    <p style="margin:12px 0 0;font-size:16px;line-height:25px;color:#415d67">
      Puoi organizzare la collezione, scannerizzare le carte, creare deck e raccoglitori personalizzati e condividere tutto con gli amici.
    </p>
    <div style="margin-top:24px;padding:15px 17px;border-radius:12px;background:#e7f8fa;color:#164b56;font-size:14px;line-height:21px">
      Buona collezione e buon divertimento su OPV.
    </div>`

  return {
    to: email,
    subject: `Benvenuto su One Piece Vault, ${username || 'nuovo giocatore'}!`,
    html: emailFrame(content),
    text: `Benvenuto, ${username || 'nuovo giocatore'}!\n\nIl tuo account su One Piece Vault e pronto. Puoi organizzare la collezione, scannerizzare le carte, creare deck e raccoglitori personalizzati e condividerli con gli amici.\n\nBuona collezione e buon divertimento su OPV.`,
    tags: [{ name: 'type', value: 'welcome' }],
  }
}

export const adminRegistrationDigestMessage = (
  recipients: RegistrationEmailRecipient[],
): EmailMessage => {
  const preview = recipients.slice(0, 50)
    .map(item => `<li style="margin:7px 0"><strong>${escapeHtml(item.username)}</strong> <span style="color:#6b7f87">${escapeHtml(item.email)}</span></li>`)
    .join('')
  const remaining = Math.max(0, recipients.length - preview.length)
  const content = `
    <h1 style="margin:0;font-size:26px;line-height:34px;color:#123f49">${recipients.length} ${recipients.length === 1 ? 'nuovo utente' : 'nuovi utenti'}</h1>
    <p style="margin:16px 0 0;font-size:15px;line-height:23px;color:#415d67">
      Riepilogo delle nuove registrazioni ricevute da OPV.
    </p>
    <ul style="margin:20px 0 0;padding-left:20px;font-size:14px;line-height:20px;color:#294650">${preview}</ul>
    ${remaining ? `<p style="margin:16px 0 0;font-size:13px;color:#6b7f87">Altri ${remaining} utenti non mostrati nell'elenco.</p>` : ''}`

  return {
    to: process.env.ADMIN_NOTIFICATION_EMAIL || 'giuseppeitalo95@gmail.com',
    subject: `OPV: ${recipients.length} ${recipients.length === 1 ? 'nuova registrazione' : 'nuove registrazioni'}`,
    html: emailFrame(content),
    text: `Nuove registrazioni OPV: ${recipients.length}\n\n${recipients.map(item => `${item.username} - ${item.email}`).join('\n')}`,
    tags: [{ name: 'type', value: 'admin_registration_digest' }],
  }
}

export const sendEmailBatch = async (
  messages: EmailMessage[],
  idempotencyKey: string,
): Promise<EmailBatchResult> => {
  const apiKey = process.env.RESEND_API_KEY?.trim()
  const from = process.env.EMAIL_FROM?.trim()
  if (!apiKey || !from) {
    return { ok: false, configured: false, sent: 0, error: 'Email service not configured' }
  }
  if (messages.length === 0) return { ok: true, configured: true, sent: 0 }
  if (messages.length > 100) {
    return { ok: false, configured: true, sent: 0, error: 'Maximum 100 emails per batch' }
  }

  const response = await fetch(RESEND_API_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey.slice(0, 256),
    },
    body: JSON.stringify(messages.map(message => ({
      from,
      to: [message.to],
      subject: message.subject,
      html: message.html,
      text: message.text,
      tags: message.tags,
    }))),
    cache: 'no-store',
  })

  const result = await response.json().catch(() => null)
  if (!response.ok) {
    return {
      ok: false,
      configured: true,
      sent: 0,
      error: result?.message || result?.error?.message || `Resend HTTP ${response.status}`,
    }
  }

  return {
    ok: true,
    configured: true,
    sent: Array.isArray(result?.data) ? result.data.length : messages.length,
  }
}

export const sendWelcomeEmailBatch = (
  recipients: RegistrationEmailRecipient[],
  idempotencyKey: string,
) => sendEmailBatch(recipients.map(welcomeMessage), idempotencyKey)

import type { Config } from '../config.js'

export interface MailMessage {
  subject: string
  text: string
}

export interface Mailer {
  send(message: MailMessage): Promise<void>
}

/**
 * SMTP mailer, or null when the relay is not configured (dev, tests, CI) —
 * callers treat null as "no alerts". nodemailer is imported lazily so nothing
 * loads it unless mail is actually switched on.
 */
export function createMailer(config: Config): Mailer | null {
  if (!config.SMTP_HOST || !config.SMTP_USER || !config.SMTP_PASSWORD) return null
  const from = config.MAIL_FROM || config.SMTP_USER
  const to = config.MAIL_TO || from
  return {
    async send({ subject, text }) {
      const { createTransport } = await import('nodemailer')
      const transport = createTransport({
        host: config.SMTP_HOST,
        port: config.SMTP_PORT,
        // 465 is implicit TLS; anything else negotiates STARTTLS.
        secure: config.SMTP_PORT === 465,
        auth: { user: config.SMTP_USER, pass: config.SMTP_PASSWORD },
      })
      await transport.sendMail({ from, to, subject, text })
      transport.close()
    },
  }
}

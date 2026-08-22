import type { Mailer } from './mailer.js'

/** One alert per athlete id per hour — a retry loop must not flood the mailbox. */
export const DENIED_NOTICE_COOLDOWN_MS = 3600_000

export interface DeniedLoginNotifierOptions {
  /** null = mail not configured; every call is then a no-op. */
  mailer: Mailer | null
  /** Base URL of the app, used to link the admin page. */
  appBaseUrl: string
  now?: () => number
  log?: (message: string) => void
}

export type DeniedLoginNotifier = (athleteId: number, athleteName: string) => Promise<void>

/**
 * Tells the owner that someone outside the allowlist tried to sign in, with the
 * ids needed to add them. Never throws: the OAuth redirect must not depend on
 * the SMTP relay being reachable.
 */
export function createDeniedLoginNotifier({
  mailer,
  appBaseUrl,
  now = Date.now,
  log,
}: DeniedLoginNotifierOptions): DeniedLoginNotifier {
  const lastSentAt = new Map<number, number>()

  return async (athleteId, athleteName) => {
    if (!mailer) return
    const at = now()
    const previous = lastSentAt.get(athleteId)
    if (previous !== undefined && at - previous < DENIED_NOTICE_COOLDOWN_MS) return
    lastSentAt.set(athleteId, at)

    const adminUrl = `${appBaseUrl.replace(/\/$/, '')}/#/admin`
    try {
      await mailer.send({
        subject: `stravaBoard: sign-in refused for athlete ${athleteId}`,
        text: [
          `${athleteName} tried to sign in to stravaBoard and is not on the allowlist.`,
          '',
          `Athlete id: ${athleteId}`,
          `Name:       ${athleteName}`,
          `When:       ${new Date(at).toISOString()}`,
          '',
          `Add them here: ${adminUrl}`,
        ].join('\n'),
      })
    } catch (err) {
      // Losing an alert is better than breaking the sign-in redirect.
      lastSentAt.delete(athleteId)
      log?.(`denied-login alert failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

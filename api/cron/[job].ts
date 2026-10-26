/**
 * GET or POST /api/cron/<tick | hourly | daily>   Header: Authorization: Bearer <CRON_SECRET>
 *
 * Scheduled work (see api/_lib/automation.ts). Called by .github/workflows/scheduled-jobs.yml
 * every 15 minutes and every hour, and by Vercel Cron once a day (vercel.json). Vercel sends
 * CRON_SECRET automatically; GitHub needs the same value as a repository secret.
 *
 * Nothing here publishes anything that an owner hasn't approved.
 */
import { timingSafeEqual } from 'node:crypto'
import { daily, guarded, hourly, tick } from '../_lib/automation.ts'
import { failure, json, routeName } from '../_lib/server.ts'

const JOBS = { tick, hourly, daily } as const

/** This run's time slot, so a second call in the same slot does nothing. */
export function slotFor(job: keyof typeof JOBS, now = new Date()): string {
  const iso = now.toISOString()
  if (job === 'daily') return iso.slice(0, 10)
  if (job === 'hourly') return iso.slice(0, 13)
  return `${iso.slice(0, 14)}${String(Math.floor(now.getUTCMinutes() / 15) * 15).padStart(2, '0')}`
}

export function authorised(req: Request): boolean {
  const secret = process.env.CRON_SECRET ?? ''
  const given = req.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? ''
  if (secret.length < 16 || given.length !== secret.length) return false
  return timingSafeEqual(Buffer.from(given), Buffer.from(secret))
}

async function run(req: Request): Promise<Response> {
  if (!process.env.CRON_SECRET) return json({ error: 'not-configured' }, 503)
  if (!authorised(req)) return json({ error: 'forbidden' }, 403)
  const job = routeName(req) as keyof typeof JOBS
  if (!(job in JOBS)) return json({ error: 'not-found' }, 404)
  try {
    return json({ job, result: await guarded(job, slotFor(job), JOBS[job]) })
  } catch (error) {
    return failure(error, `cron ${job}`)
  }
}

export const GET = run
export const POST = run

const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
const longDateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

export const formatDate = (iso: string) => dateFmt.format(new Date(iso))
export const formatLongDate = (iso: string) => longDateFmt.format(new Date(iso))

/** 3872 → "1:04:32", 97 → "1:37" */
export function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** 3872 → "1 hr 4 min", 97 → "2 min", 31 → "31 sec". Rounded, for running copy. */
export function formatRuntime(totalSeconds: number): string {
  if (totalSeconds < 60) return `${totalSeconds} sec`
  const minutes = Math.round(totalSeconds / 60)
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h ? `${h} hr${m ? ` ${m} min` : ''}` : `${m} min`
}

/** Screen-reader friendly duration: "1 hour, 4 minutes, 32 seconds". */
export function spokenDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const part = (n: number, unit: string) => (n ? `${n} ${unit}${n === 1 ? '' : 's'}` : '')
  return [part(h, 'hour'), part(m, 'minute'), part(s, 'second')].filter(Boolean).join(', ')
}

/** ISO 8601 duration for structured data, e.g. PT1H4M32S */
export function isoDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `PT${h ? `${h}H` : ''}${m ? `${m}M` : ''}${s}S`
}

export const pad2 = (n: number) => String(n).padStart(2, '0')

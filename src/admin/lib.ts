/**
 * Helpers shared by the dashboard sections: calling the server, plain-English errors,
 * dates and money, loading data, uploads and CSV downloads. Components are in ui.tsx.
 */
import { useCallback, useEffect, useState } from 'react'
import { isMissingTable } from './social/shared'
import { friendlyError } from './context'

export const API_ERRORS: Record<string, string> = {
  'signed-out': 'Your sign-in has expired. Sign in again and retry.',
  forbidden: 'Your role doesn’t allow this. Ask an owner.',
  invalid: 'Something in that request wasn’t right. Check the details and try again.',
  'not-found': 'That item no longer exists. Refresh the page.',
  'not-configured': 'The server isn’t connected to the database. Add SUPABASE_URL and SUPABASE_SECRET_KEY in Vercel.',
  'database-update-needed': 'The database needs updating first. See the notice at the top of this page.',
  'too-large': 'That file is bigger than the upload limit in Settings → AI and costs.',
  'too-long': 'That video is longer than the limit in Settings → AI and costs.',
  'upload-missing': 'The upload didn’t finish. Try uploading the file again.',
  'asset-not-ready': 'The file is still uploading or failed to upload.',
  'duration-unknown': 'The video’s length couldn’t be read in this browser. Try an MP4 file.',
  'confirm-needed': 'Please confirm the estimated cost first.',
  budget: 'This would go over the monthly budget in Settings → AI and costs.',
  'ai-budget': 'This month’s AI budget has been used. An owner can raise it in Settings → AI and costs.',
  'ai-daily-limit': 'You’ve reached today’s limit of AI requests. It resets after 24 hours, or an owner can raise it.',
  'ai-not-configured': 'AI isn’t connected yet. Add OPENAI_API_KEY in Vercel to switch it on. You can still write everything yourself.',
  'ai-key-invalid': 'The OpenAI key in Vercel was refused. Check OPENAI_API_KEY.',
  'ai-busy': 'OpenAI is busy or the account is out of credit. Try again in a minute.',
  'ai-empty': 'The AI didn’t return anything usable. Try again.',
  'clip-locked': 'This clip is rendering, approved or already sent to Social, so it can’t be rendered again now.',
  locked: 'This item is locked because it’s already been sent on.',
  'no-transcript': 'There’s no transcript for this recording yet. Analyse it first.',
  'no-speech': 'There’s too little speech in this clip to write captions from.',
  'in-use': 'This file is attached to a post that’s still waiting to be published.',
  'already-sent': 'This newsletter has already been sent.',
  'mailchimp-not-configured': 'Mailchimp isn’t connected yet. See Settings → Integrations.',
  'mailchimp-sender-missing': 'Add a reply-to address in Settings → AI and costs, or MAILCHIMP_FROM_EMAIL in Vercel.',
  'provider-not-configured': 'This platform’s app isn’t set up yet. See Settings → Integrations for the steps.',
  'encryption-not-configured': 'Add TOKEN_ENCRYPTION_KEY in Vercel before connecting accounts (Settings → Integrations).',
  'account-expired': 'The account’s sign-in has expired. Connect it again.',
  'no-facebook-page': 'No Facebook Page was found on that account. Sign in with an account that manages the Page.',
  'no-youtube-channel': 'No YouTube channel was found on that Google account.',
  busy: 'Too many requests right now. Try again in a few minutes.',
  unavailable: 'The server couldn’t finish that. Try again in a moment.',
}

export class ApiError extends Error {
  code: string
  details: Record<string, unknown>
  constructor(code: string, details: Record<string, unknown> = {}) {
    super(API_ERRORS[code] ?? 'Something went wrong. Please try again.')
    this.code = code
    this.details = details
  }
}

export async function api<T = Record<string, unknown>>(token: string, path: string, body: unknown = {}, timeoutMs = 90_000): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch(() => null)
  if (!res) throw new ApiError('unavailable')
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new ApiError(String(data.error ?? 'unavailable'), (data.details as Record<string, unknown>) ?? {})
  return data as T
}

export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '')
export const day = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleDateString(undefined, { dateStyle: 'medium' }) : '')
export const money = (usd: number) => `$${usd.toFixed(2)}`

export type LoadState<T> = { status: 'loading' } | { status: 'missing' } | { status: 'error'; message: string } | { status: 'ready'; data: T }

export function useLoad<T>(load: () => Promise<{ data: T | null; error: { message?: string; code?: string } | null }>, deps: unknown[]) {
  const [state, setState] = useState<LoadState<T>>({ status: 'loading' })
  // oxlint-disable-next-line react/exhaustive-deps -- the caller lists what the loader depends on
  const run = useCallback(load, deps)
  const reload = useCallback(async () => {
    const { data, error } = await run()
    if (isMissingTable(error)) setState({ status: 'missing' })
    else if (error) setState({ status: 'error', message: friendlyError(error) })
    else setState({ status: 'ready', data: data as T })
  }, [run])
  useEffect(() => {
    // oxlint-disable-next-line react/set-state-in-effect -- loads from Supabase; state is set when the request returns
    void reload()
  }, [reload])
  return [state, reload] as const
}

export const STATUS_TONE: Record<string, string> = {
  draft: 'bg-line text-ink',
  idea: 'bg-line text-ink',
  suggested: 'bg-line text-ink',
  pending_approval: 'bg-yellow text-ink',
  awaiting_approval: 'bg-yellow text-ink',
  rendered: 'bg-yellow text-ink',
  preview_ready: 'bg-blue/15 text-blue-ink',
  editing: 'bg-blue/15 text-blue-ink',
  rendering: 'bg-blue/15 text-blue-ink',
  approved: 'bg-[#1f7a4d] text-white',
  ready: 'bg-[#1f7a4d] text-white',
  scheduled: 'bg-blue text-white',
  sending: 'bg-blue text-white',
  published: 'bg-ink text-paper',
  sent: 'bg-ink text-paper',
  sent_to_social: 'bg-ink text-paper',
  failed: 'bg-danger text-white',
  rejected: 'bg-bone text-muted ring-1 ring-line',
  unpublished: 'bg-bone text-muted ring-1 ring-line',
  archived: 'bg-bone text-muted ring-1 ring-line',
  queued: 'bg-line text-ink',
  running: 'bg-blue text-white',
  succeeded: 'bg-[#1f7a4d] text-white',
  cancelled: 'bg-bone text-muted ring-1 ring-line',
}

export async function uploadFile(
  db: import('@supabase/supabase-js').SupabaseClient,
  token: string,
  file: File,
  kind: 'source_video' | 'image' | 'logo' | 'music' | 'intro' | 'outro',
  extra: { projectId?: string | null; durationSeconds?: number } = {},
): Promise<{ assetId: string; publicUrl: string | null }> {
  const { assetId, bucket, path, token: uploadToken } = await api<{ assetId: string; bucket: string; path: string; token: string }>(token, '/api/admin/upload-url', {
    kind,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    ...extra,
  })
  const { error } = await db.storage.from(bucket).uploadToSignedUrl(path, uploadToken, file, { contentType: file.type })
  if (error) throw new Error(error.message.includes('maximum allowed size') ? 'The file is bigger than your Supabase storage plan allows (the Free plan accepts files up to 50 MB).' : 'The upload failed. Check your connection and try again.')
  const done = await api<{ publicUrl: string | null }>(token, '/api/admin/upload-done', { assetId })
  return { assetId, publicUrl: done.publicUrl }
}

export function videoDuration(file: File): Promise<number> {
  return new Promise((resolve) => {
    const video = document.createElement('video')
    const url = URL.createObjectURL(file)
    video.preload = 'metadata'
    video.onloadedmetadata = () => (URL.revokeObjectURL(url), resolve(Number.isFinite(video.duration) ? video.duration : 0))
    video.onerror = () => (URL.revokeObjectURL(url), resolve(0))
    video.src = url
  })
}

export function downloadCsv(filename: string, csv: string) {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const labelClass = 'block text-sm font-semibold'

export interface Member {
  id: string
  full_name: string
  email: string
  role: string
}

export const memberName = (members: Member[], id: string | null) => {
  const m = members.find((x) => x.id === id)
  return m ? m.full_name || m.email : ''
}

/** 1,284 / 12.9K: numbers for tiles and chart labels. */
export const compact = (n: number) => new Intl.NumberFormat(undefined, { notation: n >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(n)

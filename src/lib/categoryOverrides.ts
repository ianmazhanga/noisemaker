/**
 * Categories chosen in the dashboard (YouTube Manager → Categories), read by the public site
 * with the publishable key. They're fetched once per visit and applied on top of the
 * hand-written and automatic categories; components that show categories call
 * useCategoryVersion() so they update when the choices arrive.
 *
 * If the table doesn't exist yet or Supabase is unreachable, the site simply keeps the
 * hand-written and automatic categories.
 */
import { useEffect, useSyncExternalStore } from 'react'
import { applyTopicOverrides } from './content'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '')
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

let version = 0
let loading: Promise<void> | null = null
const listeners = new Set<() => void>()

/** Fetches the dashboard's category choices and applies them. `force` refetches (after an admin saves). */
export function loadCategoryOverrides(force = false): Promise<void> {
  if (loading && !force) return loading
  loading = (async () => {
    if (!url || !key) return
    const headers: Record<string, string> = { apikey: key }
    if (key.startsWith('eyJ')) headers.Authorization = `Bearer ${key}`
    try {
      const res = await fetch(`${url}/rest/v1/episode_categories?select=youtube_id,topic`, { headers, signal: AbortSignal.timeout(8000) })
      if (!res.ok) return
      const rows = (await res.json()) as { youtube_id: string; topic: string }[]
      applyTopicOverrides(new Map(rows.map((r) => [r.youtube_id, r.topic])))
      version++
      for (const l of listeners) l()
    } catch {
      // Keep the categories the site was built with.
    }
  })()
  return loading
}

const subscribe = (l: () => void) => {
  listeners.add(l)
  return () => listeners.delete(l)
}

/** Re-renders the caller when dashboard category choices arrive. Starts the fetch on first use. */
export function useCategoryVersion(): number {
  useEffect(() => {
    void loadCategoryOverrides()
  }, [])
  return useSyncExternalStore(subscribe, () => version, () => version)
}

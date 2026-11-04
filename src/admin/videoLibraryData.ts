import { useEffect, useState } from 'react'
import { useAdmin } from './context'
import { useLoad } from './lib'

/**
 * A finished video in the library. Stored in the private "media" bucket as a media_assets row:
 * `filename` holds the title shown in the dashboard, and `license_note` (the file's free-text
 * note) holds the optional description. No database change was needed.
 */
export interface LibraryVideo {
  id: string
  bucket: string
  path: string
  filename: string
  license_note: string
  size_bytes: number
  duration_seconds: number | null
  created_at: string
}

/** Finished videos, newest first, with short-lived private links for previews. */
export function useLibrary() {
  const { db } = useAdmin()
  const [state, reload] = useLoad(async () => {
    const { data, error } = await db
      .from('media_assets')
      .select('id, bucket, path, filename, license_note, size_bytes, duration_seconds, created_at')
      .in('kind', ['source_video', 'clip_final'])
      .eq('status', 'ready')
      .order('created_at', { ascending: false })
      .limit(200)
    return { data: (data ?? []) as LibraryVideo[], error }
  }, [db])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const videos = state.status === 'ready' ? state.data : null
  useEffect(() => {
    if (!videos?.length) return
    void db.storage
      .from('media')
      .createSignedUrls(videos.map((v) => v.path), 3600)
      .then(({ data }) => setUrls(Object.fromEntries((Array.isArray(data) ? data : []).map((d, i) => [videos[i].id, d.signedUrl ?? '']))))
  }, [db, videos])
  return { state, reload, urls }
}


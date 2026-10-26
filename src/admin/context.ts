import { createContext, useContext } from 'react'
import type { Session, SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '../lib/supabase'
import { FIELD_NAMES } from '../lib/storyForm'
import type { InboxEntry } from '../lib/inbox'
import type { StoryStatus } from '../lib/supabase'

export interface AdminState {
  db: SupabaseClient
  session: Session
  profile: Profile
  /** Owners always; content managers when the owner allows it. The database enforces the same rule. */
  canReadStories: boolean
  isOwner: boolean
  /** Live counts. Null while loading or when the person can't see them. */
  newStories: number | null
  unread: number | null
  /** Social posts waiting for an owner's approval. Null until the social tables exist. */
  pendingPosts: number | null
  refreshCounts: () => void
  refreshProfile: () => Promise<void>
  toast: (message: string, kind?: 'success' | 'error') => void
}

export const AdminContext = createContext<AdminState | null>(null)

export function useAdmin(): AdminState {
  const ctx = useContext(AdminContext)
  if (!ctx) throw new Error('useAdmin must be used inside the admin dashboard')
  return ctx
}

export interface StoryRow extends Record<(typeof FIELD_NAMES)[number], string> {
  id: string
  received_at: string
  status: StoryStatus
  status_changed_at: string | null
}

/** A database row in the shape the inbox components already use. */
export function toEntry(row: StoryRow): InboxEntry {
  const fields = Object.fromEntries(FIELD_NAMES.map((name) => [name, row[name] ?? ''])) as InboxEntry['fields']
  return { id: row.id, receivedAt: row.received_at, fields }
}

/** Minimum length for dashboard passwords. Set the same in Supabase → Authentication → Policies. */
export const MIN_PASSWORD = 12

/** "Couldn't save" messages that don't leak database details. */
export function friendlyError(error: { message?: string; code?: string } | null): string {
  if (!error) return 'Something went wrong. Please try again.'
  if (error.code === '42501' || /permission|row-level/i.test(error.message ?? '')) return 'You don’t have permission to do that.'
  if (/fetch|network/i.test(error.message ?? '')) return 'Couldn’t reach the server. Check your connection and try again.'
  return error.message && error.message.length < 120 ? error.message : 'Something went wrong. Please try again.'
}

/**
 * Supabase client for the owner dashboard (/admin). Only the admin pages import this,
 * so the public site never downloads it.
 *
 * VITE_SUPABASE_URL and VITE_SUPABASE_KEY are the project URL and its publishable
 * (or legacy anon) key. Both are meant to be public: the database's Row Level Security
 * decides what each signed-in person can see. Never put the secret key in a VITE_ variable.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined

/** Null until the two environment variables are set. The dashboard then shows setup instructions. */
export const supabase: SupabaseClient | null = url && key ? createClient(url, key) : null

export type StaffRole = 'owner' | 'editor' | 'content_manager' | 'viewer'
export type StoryStatus = 'new' | 'under_review' | 'contacted' | 'approved' | 'declined'

export interface Profile {
  id: string
  email: string
  full_name: string
  role: StaffRole | null
  can_view_stories: boolean
  created_at: string
}

export const ROLE_LABEL: Record<StaffRole, string> = { owner: 'Owner', editor: 'Editor', content_manager: 'Content Manager', viewer: 'Viewer' }

export const STATUS_LABEL: Record<StoryStatus, string> = {
  new: 'New',
  under_review: 'Under review',
  contacted: 'Contacted',
  approved: 'Approved',
  declined: 'Declined',
}

export const STATUSES = Object.keys(STATUS_LABEL) as StoryStatus[]

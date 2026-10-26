/**
 * Statuses, labels and small helpers for the newsroom sections: video production, AI Shorts,
 * news, newsletters and the calendar. They match the checks in
 * supabase/migrations/20261028000000_newsroom.sql.
 *
 * No imports, so the server and tests can run this file directly in Node.
 */

export type Role = 'owner' | 'editor' | 'content_manager' | 'viewer'

export const ROLE_INFO: Record<Role, { label: string; can: string }> = {
  owner: { label: 'Owner', can: 'Everything: approves and publishes, manages the team, settings and connected accounts.' },
  editor: { label: 'Editor', can: 'Writes and edits articles, newsletters, videos, clips and posts, and sends them for approval.' },
  content_manager: { label: 'Content Manager', can: 'Same as an Editor: drafts content and sends it for approval.' },
  viewer: { label: 'Viewer', can: 'Reads the dashboard. Can’t change anything.' },
}

export const ROLES = Object.keys(ROLE_INFO) as Role[]
export const isWriterRole = (role: string | null | undefined) => role === 'owner' || role === 'editor' || role === 'content_manager'

// ---------------------------------------------------------------------------
// Video production
// ---------------------------------------------------------------------------

export type ProjectStatus =
  | 'idea'
  | 'interview_scheduled'
  | 'preparing'
  | 'scripting'
  | 'recording_scheduled'
  | 'recorded'
  | 'awaiting_edit'
  | 'editing'
  | 'awaiting_approval'
  | 'ready'
  | 'published'
  | 'archived'

/** In pipeline order: each is a column on the Video Production board. */
export const PROJECT_STATUS: Record<ProjectStatus, string> = {
  idea: 'Video ideas',
  interview_scheduled: 'Upcoming interviews',
  preparing: 'Interview preparation',
  scripting: 'Script writing',
  recording_scheduled: 'Recording scheduled',
  recorded: 'Uploaded recordings',
  awaiting_edit: 'Awaiting editing',
  editing: 'Being edited',
  awaiting_approval: 'Awaiting approval',
  ready: 'Ready to publish',
  published: 'Published',
  archived: 'Archived',
}

export const PROJECT_STATUSES = Object.keys(PROJECT_STATUS) as ProjectStatus[]
/** Only owners move a project to these. */
export const OWNER_PROJECT_STATUSES: ProjectStatus[] = ['ready', 'published']

/** What the AI Interview Assistant can prepare. */
export const INTERVIEW_TOOLS = {
  questions: 'Interview questions',
  followups: 'Follow-up questions',
  outline: 'Interview outline',
  topics: 'Discussion topics',
  research: 'Guest research summary',
  script: 'Video script',
  titles: 'Video titles',
  description: 'YouTube description',
  thumbnail: 'Thumbnail text',
  hashtags: 'Hashtags',
  captions: 'Promotional captions',
} as const

export type InterviewTool = keyof typeof INTERVIEW_TOOLS
export const INTERVIEW_TOOL_KEYS = Object.keys(INTERVIEW_TOOLS) as InterviewTool[]

// ---------------------------------------------------------------------------
// AI Shorts
// ---------------------------------------------------------------------------

export type ClipStatus = 'suggested' | 'editing' | 'rendering' | 'preview_ready' | 'rendered' | 'approved' | 'rejected' | 'sent_to_social'

export const CLIP_STATUS: Record<ClipStatus, string> = {
  suggested: 'Suggested',
  editing: 'Being edited',
  rendering: 'Rendering',
  preview_ready: 'Preview ready',
  rendered: 'Ready for review',
  approved: 'Approved',
  rejected: 'Rejected',
  sent_to_social: 'Sent to Social',
}

export const CLIP_CATEGORY = {
  emotional: 'Emotional moment',
  insight: 'Strong answer',
  educational: 'Educational',
  story: 'Personal story',
  discussion: 'Engaging discussion',
  other: 'Other',
} as const

export type ClipCategory = keyof typeof CLIP_CATEGORY

export const CLIP_LENGTHS = [15, 30, 45, 60] as const
export const MAX_CLIP_SECONDS = 180

export type CropMode = 'center' | 'left' | 'right' | 'custom' | 'split'

export const CROP_MODES: Record<CropMode, string> = {
  center: 'Centre of the frame',
  left: 'Left side (speaker on the left)',
  right: 'Right side (speaker on the right)',
  custom: 'Custom position',
  split: 'Split screen: both speakers, stacked',
}

export interface Crop {
  mode: CropMode
  /** 0 = far left, 1 = far right. Used by custom (and the top half of split). */
  x: number
  /** Bottom half of split screen. */
  x2?: number
}

export const SUBTITLE_FONTS = ['Inter', 'DejaVu Sans', 'Liberation Sans'] as const
export type SubtitleFont = (typeof SUBTITLE_FONTS)[number]

export interface SubtitleStyle {
  /** Installed on the video worker (fonts-inter, fonts-dejavu-core, fonts-liberation) */
  font: SubtitleFont
  /** Height of a line as a share of the video height, e.g. 0.045 */
  size: number
  /** Distance of the subtitles from the bottom, as a share of the height */
  position: number
  background: 'none' | 'box' | 'shadow'
  /** Colour the word being spoken */
  highlight: boolean
  highlightColor: string
  uppercase: boolean
}

export interface ClipStyle {
  subtitles: SubtitleStyle | null
  watermark: boolean
  titleOverlay: string
  introAssetId: string
  outroAssetId: string
  /** 1 = unchanged */
  volume: number
  denoise: boolean
  musicAssetId: string
  musicVolume: number
}

export const DEFAULT_SUBTITLES: SubtitleStyle = {
  font: 'Inter',
  size: 0.042,
  position: 0.2,
  background: 'shadow',
  highlight: true,
  highlightColor: '#F7D046',
  uppercase: false,
}

export const DEFAULT_STYLE: ClipStyle = {
  subtitles: DEFAULT_SUBTITLES,
  watermark: true,
  titleOverlay: '',
  introAssetId: '',
  outroAssetId: '',
  volume: 1,
  denoise: false,
  musicAssetId: '',
  musicVolume: 0.12,
}

/** Clip style from the database, with defaults for anything missing or malformed. */
export function readStyle(raw: unknown): ClipStyle {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<ClipStyle>
  const sub = s.subtitles === null ? null : { ...DEFAULT_SUBTITLES, ...(s.subtitles && typeof s.subtitles === 'object' ? s.subtitles : {}) }
  const num = (v: unknown, min: number, max: number, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback)
  if (sub) {
    sub.size = num(sub.size, 0.02, 0.1, DEFAULT_SUBTITLES.size)
    sub.position = num(sub.position, 0.05, 0.9, DEFAULT_SUBTITLES.position)
    if (!/^#[0-9a-f]{6}$/i.test(sub.highlightColor)) sub.highlightColor = DEFAULT_SUBTITLES.highlightColor
    if (!SUBTITLE_FONTS.includes(sub.font)) sub.font = DEFAULT_SUBTITLES.font
    if (!['none', 'box', 'shadow'].includes(sub.background)) sub.background = DEFAULT_SUBTITLES.background
  }
  return {
    subtitles: sub,
    watermark: s.watermark !== false,
    titleOverlay: typeof s.titleOverlay === 'string' ? s.titleOverlay.slice(0, 80) : '',
    introAssetId: typeof s.introAssetId === 'string' ? s.introAssetId : '',
    outroAssetId: typeof s.outroAssetId === 'string' ? s.outroAssetId : '',
    volume: num(s.volume, 0, 3, 1),
    denoise: s.denoise === true,
    musicAssetId: typeof s.musicAssetId === 'string' ? s.musicAssetId : '',
    musicVolume: num(s.musicVolume, 0, 1, DEFAULT_STYLE.musicVolume),
  }
}

export function readCrop(raw: unknown): Crop {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Partial<Crop>
  const mode = (Object.keys(CROP_MODES) as CropMode[]).includes(c.mode as CropMode) ? (c.mode as CropMode) : 'center'
  const clamp = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : fallback)
  return { mode, x: clamp(c.x, 0.5), x2: clamp(c.x2, 0.5) }
}

/** Per-platform text the AI writes for each clip. */
export interface ClipCaptions {
  youtube_title?: string
  youtube?: string
  tiktok?: string
  instagram?: string
  facebook?: string
  x?: string
  hashtags?: string[]
  description?: string
  suggested_time?: string
  warnings?: string[]
}

// ---------------------------------------------------------------------------
// News and newsletters
// ---------------------------------------------------------------------------

export type ArticleStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'published' | 'unpublished' | 'archived' | 'rejected'

export const ARTICLE_STATUS: Record<ArticleStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  unpublished: 'Unpublished',
  archived: 'Archived',
  rejected: 'Rejected',
}

export const ARTICLE_STATUSES = Object.keys(ARTICLE_STATUS) as ArticleStatus[]

export type CampaignStatus = 'draft' | 'pending_approval' | 'approved' | 'scheduled' | 'sending' | 'sent' | 'failed' | 'rejected'

export const CAMPAIGN_STATUS: Record<CampaignStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Awaiting approval',
  approved: 'Approved',
  scheduled: 'Scheduled',
  sending: 'Sending',
  sent: 'Sent',
  failed: 'Failed',
  rejected: 'Rejected',
}

export const CAMPAIGN_STATUSES = Object.keys(CAMPAIGN_STATUS) as CampaignStatus[]

export interface ArticleSource {
  title: string
  url: string
  publisher: string
  published_at?: string
}

/** "Mamelodi's new library opens!" → "mamelodis-new-library-opens" */
export function slugify(text: string, max = 80): string {
  const slug = text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/, '')
  return slug || 'article'
}

/** Countries the news agent can filter by. */
export const NEWS_COUNTRIES: Record<string, string> = {
  ZA: 'South Africa',
  US: 'United States',
  GB: 'United Kingdom',
  ZW: 'Zimbabwe',
  NG: 'Nigeria',
  KE: 'Kenya',
  INT: 'International',
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/** Every kind of notification, for the preferences screen. */
export const NOTIFICATION_KINDS: Record<string, string> = {
  'story.new': 'A new story or call request arrives',
  'interview.created': 'An approved story becomes an interview project',
  'post.pending': 'A social post needs approval',
  'post.failed': 'A scheduled post fails to publish',
  'clip.ready': 'A video clip is ready to review',
  'job.failed': 'A video job or background task fails',
  'video.pending': 'A video needs approval',
  'article.pending': 'An article needs approval',
  'newsletter.pending': 'A newsletter needs approval',
  'newsletter.draft': 'The weekly newsletter draft is ready',
  'account.expired': 'A social media connection expires',
  'youtube.new': 'A new video appears on the YouTube channel',
}

/** Which day and time a scheduled item clashes with: two items on the same channel within this many minutes. */
export const CONFLICT_MINUTES = 60

export interface CalendarItem {
  uid: string
  item_type: 'post' | 'article' | 'newsletter' | 'recording' | 'youtube' | 'event'
  item_id: string | null
  channel: string
  title: string
  at: string
  status: string
  approved: boolean
  person_id: string | null
  link: string
}

/** Items on the same channel scheduled within CONFLICT_MINUTES of each other (published items don't count). */
export function findConflicts(items: CalendarItem[]): Set<string> {
  const clash = new Set<string>()
  const upcoming = items.filter((i) => !['published', 'sent', 'done', 'cancelled'].includes(i.status) && i.item_type !== 'youtube')
  const byChannel = new Map<string, CalendarItem[]>()
  for (const i of upcoming) byChannel.set(i.channel, [...(byChannel.get(i.channel) ?? []), i])
  for (const list of byChannel.values()) {
    list.sort((a, b) => a.at.localeCompare(b.at))
    for (let k = 1; k < list.length; k++) {
      if (Date.parse(list[k].at) - Date.parse(list[k - 1].at) < CONFLICT_MINUTES * 60_000) {
        clash.add(list[k].uid)
        clash.add(list[k - 1].uid)
      }
    }
  }
  return clash
}

/** Rows to CSV, quoting every cell and neutralising spreadsheet formulas. */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          let text = cell === null || cell === undefined ? '' : String(cell)
          if (typeof cell === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
          return `"${text.replace(/"/g, '""')}"`
        })
        .join(','),
    )
    .join('\r\n')
}

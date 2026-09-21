import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(url, key)

export type Profile = {
  id: string
  display_name: string | null
  avatar_url: string | null
  role: 'admin' | 'member'
  status: 'pending' | 'active' | 'blocked'
  agent_daily_quota: number
}

export type Course = {
  id: string
  title: string
  lecturer: string | null
  institution: string | null
  year_label: string | null
  semester: string | null
  color: string
  exam_date: string | null
  archived: boolean
  position: number
}

export type AppSettings = {
  id: true
  require_signup_approval: boolean
  app_name: string
}

export type DocumentKind = 'summary' | 'ruling' | 'law' | 'exam' | 'slides' | 'other'

export type DocumentRow = {
  id: string
  blob_sha256: string
  kind: DocumentKind
  original_filename: string | null
  owner_id: string | null
  visibility: 'core' | 'shared' | 'private'
  status: 'approved' | 'pending' | 'rejected'
  created_at: string
}

export type BlobRow = {
  sha256: string
  bytes: number
  mime: string
  storage_path: string
  ref_count: number
}

export type Summary = {
  id: string
  course_id: string
  document_id: string | null
  version: number
  title: string
  status: 'draft' | 'published'
  created_at: string
  updated_at: string
}

/** A summary joined with its underlying document + blob, as returned by the list query. */
export type SummaryWithFile = Summary & {
  documents: (DocumentRow & { blobs: BlobRow | null }) | null
}

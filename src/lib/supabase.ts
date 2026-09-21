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

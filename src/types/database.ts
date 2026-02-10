// Supabase 테이블 타입 정의

// JSON 타입 (Supabase jsonb 컬럼용)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export interface Account {
  id: string
  name: string
  platform: string
  url: string | null
  blog_score: number
  daily_publish_limit: number
  created_at: string
  updated_at: string
}

export interface Keyword {
  id: string
  account_id: string | null
  keyword: string
  sub_keyword: string | null
  url: string | null
  monthly_search_pc: number
  monthly_search_mo: number
  monthly_search_total: number
  competition: string
  mobile_ratio: number
  difficulty_score: number
  opportunity_score: number
  created_at: string
  updated_at: string
}

export interface SerpResult {
  id: string
  keyword_id: string
  device: 'PC' | 'MO'
  rank: number | null
  rank_change: number
  url: string | null
  is_exposed: boolean
  captured_at: string
  created_at: string
}

export interface Setting {
  id: string
  key: string
  value: Record<string, unknown> | null
  description: string | null
  updated_at: string
}

// 설정 값 타입
export interface BlogScoreFormula {
  exposure_weight: number
  rank_weight: number
  quality_weight: number
  description: string
}

export interface DailyPublishLimits {
  high_tier_threshold: number
  medium_tier_threshold: number
  high_limit: number
  medium_limit: number
  low_limit: number
  description: string
}

export interface SerpTrackingConfig {
  rank_max: number
  unexposed_rank: number
  search_sleep_min: number
  search_sleep_max: number
  description: string
}

export interface EC2ApiConfig {
  base_url: string
  secret: string
  description: string
}

export interface GPTPromptConfig {
  model: string
  prompt: string
  description: string
}

export interface SlackWebhookConfig {
  enabled: boolean
  webhook_url: string
  notify_serp_complete: boolean
  notify_unexposed_alert: boolean
  notify_weekly_report: boolean
  description: string
}

export interface PublishRecord {
  id: string
  main_keyword: string
  sub_keyword: string | null
  title: string
  source_file: string | null
  account_name: string
  published_date: string | null
  camfit_link: boolean
  url: string | null
  rank_24h: string | null
  rank_pc: number | null
  rank_mo: number | null
  rank_change_pc: number
  rank_change_mo: number
  search_pc: number
  search_mo: number
  search_total: number
  competition: string
  mobile_ratio: number
  opportunity_score: number
  data_date: string | null
  created_at: string
  updated_at: string
}

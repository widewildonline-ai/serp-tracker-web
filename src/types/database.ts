// Supabase 테이블 타입 정의 V2
// 키워드:콘텐츠 1:N 구조

// JSON 타입 (Supabase jsonb 컬럼용)
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

// ============================================
// 1. accounts (계정)
// ============================================
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

// ============================================
// 2. keywords (키워드 - 검색량/경쟁도 정보)
// ============================================
export interface Keyword {
  id: string
  keyword: string           // 메인 키워드 (UNIQUE)
  sub_keyword: string | null
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

// ============================================
// 3. contents (발행된 콘텐츠)
// ============================================
export interface Content {
  id: string
  keyword_id: string
  account_id: string | null
  url: string
  title: string | null
  published_date: string | null
  is_active: boolean        // 순위 추적 여부
  camfit_link: boolean
  source_file: string | null
  created_at: string
  updated_at: string
}

// 콘텐츠 + 관계 데이터
export interface ContentWithRelations extends Content {
  keyword?: Pick<Keyword, 'id' | 'keyword' | 'sub_keyword' | 'monthly_search_total' | 'competition'>
  account?: Pick<Account, 'id' | 'name'> | null
  serp_results?: SerpResult[]
}

// ============================================
// 4. serp_results (콘텐츠별 SERP 결과)
// ============================================
export interface SerpResult {
  id: string
  content_id: string        // keyword_id → content_id 변경
  device: 'PC' | 'MO'
  rank: number | null
  rank_change: number
  is_exposed: boolean
  captured_at: string
  created_at: string
}

// ============================================
// 5. settings (설정)
// ============================================
export interface Setting {
  id: string
  key: string
  value: Record<string, unknown> | null
  description: string | null
  updated_at: string
}

// ============================================
// 확장 타입 (UI용)
// ============================================

// 키워드 + 콘텐츠 목록
export interface KeywordWithContents extends Keyword {
  contents: ContentWithRelations[]
  // 집계 데이터
  totalContents: number
  activeContents: number
  exposedContents: number
}

// 발행 추천 아이템
export interface PublishRecommendation {
  keyword: Keyword
  contents: ContentWithRelations[]
  status: 'urgent' | 'recovery' | 'new'  // 긴급/복구/신규
  reason: string
  recommendedAccount: Account | null
  expectedImpact: number
  exposureProb: number
}

// ============================================
// 설정 값 타입
// ============================================
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

// ============================================
// 레거시 타입 (마이그레이션용)
// ============================================
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

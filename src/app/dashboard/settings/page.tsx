'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Setting } from '@/types/database'

export default function SettingsPage() {
  const [settings, setSettings] = useState<Setting[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'formula' | 'serp' | 'prompts' | 'api' | 'slack'>('formula')
  
  const supabase = createClient()

  // 데이터 로드
  const loadSettings = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('settings')
      .select('*')
      .order('key')
    
    if (error) {
      setError('설정을 불러오는데 실패했습니다.')
    } else {
      setSettings(data || [])
    }
    setLoading(false)
  }

  useEffect(() => {
    loadSettings()
  }, [])

  // 설정 값 가져오기
  const getSetting = (key: string): Setting | undefined => {
    return settings.find(s => s.key === key)
  }

  // 설정 저장
  const saveSetting = async (key: string, value: Record<string, unknown>) => {
    setSaving(key)
    setError(null)

    const { error } = await supabase
      .from('settings')
      .update({ 
        value,
        updated_at: new Date().toISOString()
      })
      .eq('key', key)

    if (error) {
      setError('저장 실패: ' + error.message)
    } else {
      setSuccess('설정이 저장되었습니다.')
      loadSettings()
    }
    setSaving(null)
  }

  // 알림 자동 숨김
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null)
        setSuccess(null)
      }, 3000)
      return () => clearTimeout(timer)
    }
  }, [error, success])

  const tabs = [
    { id: 'formula' as const, label: '📊 지표 계산', icon: '📊' },
    { id: 'serp' as const, label: '🔍 SERP 설정', icon: '🔍' },
    { id: 'prompts' as const, label: '🤖 GPT 프롬프트', icon: '🤖' },
    { id: 'api' as const, label: '🔗 API 연동', icon: '🔗' },
    { id: 'slack' as const, label: '💬 Slack 알림', icon: '💬' },
  ]

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-white">설정</h1>
        <p className="text-slate-400 mt-1">시스템 설정을 관리합니다. 모든 변경사항은 즉시 반영됩니다.</p>
      </div>

      {/* 알림 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4 text-emerald-400">
          {success}
        </div>
      )}

      {/* 탭 네비게이션 */}
      <div className="border-b border-slate-700">
        <nav className="flex gap-4">
          {tabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-3 text-sm font-medium border-b-2 transition ${
                activeTab === tab.id
                  ? 'border-purple-500 text-purple-400'
                  : 'border-transparent text-slate-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {loading ? (
        <div className="p-8 text-center text-slate-400">
          <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          로딩 중...
        </div>
      ) : (
        <>
          {/* 지표 계산 탭 */}
          {activeTab === 'formula' && (
            <div className="space-y-6">
              <BlogScoreFormulaEditor 
                setting={getSetting('blog_score_formula')} 
                onSave={saveSetting}
                saving={saving === 'blog_score_formula'}
              />
              <DailyLimitsEditor 
                setting={getSetting('daily_publish_limits')} 
                onSave={saveSetting}
                saving={saving === 'daily_publish_limits'}
              />
            </div>
          )}

          {/* SERP 설정 탭 */}
          {activeTab === 'serp' && (
            <SerpSettingsEditor 
              setting={getSetting('serp_tracking')} 
              onSave={saveSetting}
              saving={saving === 'serp_tracking'}
            />
          )}

          {/* GPT 프롬프트 탭 */}
          {activeTab === 'prompts' && (
            <div className="space-y-6">
              <PromptEditor 
                setting={getSetting('gpt_keyword_extraction')} 
                onSave={saveSetting}
                saving={saving === 'gpt_keyword_extraction'}
                title="키워드 추출 프롬프트"
                description="블로그 제목에서 메인/서브 키워드를 추출하는 프롬프트"
              />
              <PromptEditor 
                setting={getSetting('gpt_serp_analysis')} 
                onSave={saveSetting}
                saving={saving === 'gpt_serp_analysis'}
                title="SERP 분석 프롬프트"
                description="SERP 데이터 분석 및 전략 제안용 프롬프트"
              />
            </div>
          )}

          {/* API 연동 탭 */}
          {activeTab === 'api' && (
            <EC2ApiEditor 
              setting={getSetting('ec2_api')} 
              onSave={saveSetting}
              saving={saving === 'ec2_api'}
            />
          )}

          {/* Slack 알림 탭 */}
          {activeTab === 'slack' && (
            <SlackSettingsEditor 
              setting={getSetting('slack_webhook')} 
              onSave={saveSetting}
              saving={saving === 'slack_webhook'}
            />
          )}
        </>
      )}
    </div>
  )
}

// 블로그 지수 계산 공식 에디터
function BlogScoreFormulaEditor({
  setting,
  onSave,
  saving,
}: {
  setting: Setting | undefined
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
}) {
  const defaultValue = {
    exposure_weight: 40,
    rank_weight: 30,
    quality_weight: 30,
    description: 'blog_score = (노출키워드비율 × exposure_weight) + (평균순위점수 × rank_weight) + (키워드품질 × quality_weight)',
  }
  
  const [formData, setFormData] = useState(setting?.value || defaultValue)

  useEffect(() => {
    if (setting?.value) {
      setFormData(setting.value)
    }
  }, [setting])

  const handleSave = () => {
    onSave('blog_score_formula', formData as Record<string, unknown>)
  }

  const total = ((formData as typeof defaultValue).exposure_weight || 0) + 
                ((formData as typeof defaultValue).rank_weight || 0) + 
                ((formData as typeof defaultValue).quality_weight || 0)

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-semibold text-white">📊 블로그 지수 계산 공식</h3>
        <p className="text-slate-500 text-sm mt-1">
          각 항목의 가중치를 설정합니다. 합계는 100이 되어야 합니다.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* 공식 미리보기 */}
        <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm">
          <p className="text-slate-400 mb-2">// 현재 적용 중인 공식</p>
          <p className="text-emerald-400">
            blog_score = (노출키워드비율 × <span className="text-purple-400">{(formData as typeof defaultValue).exposure_weight}</span>) + 
            (평균순위점수 × <span className="text-purple-400">{(formData as typeof defaultValue).rank_weight}</span>) + 
            (키워드품질 × <span className="text-purple-400">{(formData as typeof defaultValue).quality_weight}</span>)
          </p>
        </div>

        {/* 가중치 입력 */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              노출키워드비율 가중치
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={(formData as typeof defaultValue).exposure_weight}
              onChange={(e) => setFormData({ ...formData, exposure_weight: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              평균순위점수 가중치
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={(formData as typeof defaultValue).rank_weight}
              onChange={(e) => setFormData({ ...formData, rank_weight: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              키워드품질 가중치
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={(formData as typeof defaultValue).quality_weight}
              onChange={(e) => setFormData({ ...formData, quality_weight: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* 합계 표시 */}
        <div className={`flex items-center justify-between p-4 rounded-lg ${
          total === 100 ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'
        }`}>
          <span className={total === 100 ? 'text-emerald-400' : 'text-red-400'}>
            가중치 합계: {total}
          </span>
          {total !== 100 && (
            <span className="text-red-400 text-sm">⚠️ 합계가 100이 아닙니다</span>
          )}
        </div>

        {/* 저장 버튼 */}
        <div className="flex justify-end">
          <button
            onClick={handleSave}
            disabled={saving || total !== 100}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? '저장 중...' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 일일 발행 한도 에디터
function DailyLimitsEditor({
  setting,
  onSave,
  saving,
}: {
  setting: Setting | undefined
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
}) {
  const defaultValue = {
    high_tier_threshold: 70,
    medium_tier_threshold: 40,
    high_limit: 4,
    medium_limit: 3,
    low_limit: 2,
    description: '계정 등급별 일일 발행 한도',
  }
  
  const [formData, setFormData] = useState(setting?.value || defaultValue)

  useEffect(() => {
    if (setting?.value) {
      setFormData(setting.value)
    }
  }, [setting])

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-semibold text-white">📈 계정 등급별 발행 한도</h3>
        <p className="text-slate-500 text-sm mt-1">
          블로그 지수에 따른 계정 등급과 일일 발행 한도를 설정합니다.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* 등급 기준 */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              고등급 기준 (이상)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={(formData as typeof defaultValue).high_tier_threshold}
              onChange={(e) => setFormData({ ...formData, high_tier_threshold: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              중등급 기준 (이상)
            </label>
            <input
              type="number"
              min="0"
              max="100"
              value={(formData as typeof defaultValue).medium_tier_threshold}
              onChange={(e) => setFormData({ ...formData, medium_tier_threshold: parseInt(e.target.value) || 0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        {/* 발행 한도 */}
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-lg p-4">
            <label className="block text-sm font-medium text-emerald-400 mb-2">
              고등급 한도
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={(formData as typeof defaultValue).high_limit}
              onChange={(e) => setFormData({ ...formData, high_limit: parseInt(e.target.value) || 1 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              지수 {(formData as typeof defaultValue).high_tier_threshold}점 이상
            </p>
          </div>
          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4">
            <label className="block text-sm font-medium text-yellow-400 mb-2">
              중등급 한도
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={(formData as typeof defaultValue).medium_limit}
              onChange={(e) => setFormData({ ...formData, medium_limit: parseInt(e.target.value) || 1 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-yellow-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              지수 {(formData as typeof defaultValue).medium_tier_threshold}~{(formData as typeof defaultValue).high_tier_threshold - 1}점
            </p>
          </div>
          <div className="bg-slate-500/10 border border-slate-500/30 rounded-lg p-4">
            <label className="block text-sm font-medium text-slate-400 mb-2">
              저등급 한도
            </label>
            <input
              type="number"
              min="1"
              max="10"
              value={(formData as typeof defaultValue).low_limit}
              onChange={(e) => setFormData({ ...formData, low_limit: parseInt(e.target.value) || 1 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-slate-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              지수 {(formData as typeof defaultValue).medium_tier_threshold - 1}점 이하
            </p>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => onSave('daily_publish_limits', formData as Record<string, unknown>)}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? '저장 중...' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

// SERP 설정 에디터
function SerpSettingsEditor({
  setting,
  onSave,
  saving,
}: {
  setting: Setting | undefined
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
}) {
  const defaultValue = {
    rank_max: 20,
    unexposed_rank: 21,
    search_sleep_min: 1.0,
    search_sleep_max: 2.0,
    description: 'SERP 추적 설정',
  }
  
  const [formData, setFormData] = useState(setting?.value || defaultValue)

  useEffect(() => {
    if (setting?.value) {
      setFormData(setting.value)
    }
  }, [setting])

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-semibold text-white">🔍 SERP 추적 설정</h3>
        <p className="text-slate-500 text-sm mt-1">
          검색 결과 추적 관련 설정을 관리합니다.
        </p>
      </div>

      <div className="p-6 space-y-6">
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              최대 순위 추적
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={(formData as typeof defaultValue).rank_max}
              onChange={(e) => setFormData({ ...formData, rank_max: parseInt(e.target.value) || 20 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              이 순위까지 검색 결과를 확인합니다
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              미노출 기준값
            </label>
            <input
              type="number"
              min="1"
              max="100"
              value={(formData as typeof defaultValue).unexposed_rank}
              onChange={(e) => setFormData({ ...formData, unexposed_rank: parseInt(e.target.value) || 21 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="text-xs text-slate-500 mt-2">
              변동 계산 시 미노출을 이 값으로 간주
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              검색 간격 (최소, 초)
            </label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={(formData as typeof defaultValue).search_sleep_min}
              onChange={(e) => setFormData({ ...formData, search_sleep_min: parseFloat(e.target.value) || 1.0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              검색 간격 (최대, 초)
            </label>
            <input
              type="number"
              min="0.1"
              max="10"
              step="0.1"
              value={(formData as typeof defaultValue).search_sleep_max}
              onChange={(e) => setFormData({ ...formData, search_sleep_max: parseFloat(e.target.value) || 2.0 })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => onSave('serp_tracking', formData as Record<string, unknown>)}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? '저장 중...' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

// GPT 프롬프트 에디터
function PromptEditor({
  setting,
  onSave,
  saving,
  title,
  description,
}: {
  setting: Setting | undefined
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
  title: string
  description: string
}) {
  const defaultValue = {
    model: 'gpt-4o-mini',
    prompt: '',
    description: '',
  }
  
  const [formData, setFormData] = useState(setting?.value || defaultValue)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (setting?.value) {
      setFormData(setting.value)
    }
  }, [setting])

  if (!setting) return null

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 border-b border-slate-700 flex items-center justify-between hover:bg-slate-700/30"
      >
        <div className="text-left">
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="text-slate-500 text-sm mt-1">{description}</p>
        </div>
        <span className={`text-slate-400 transition-transform ${expanded ? 'rotate-180' : ''}`}>
          ▼
        </span>
      </button>

      {expanded && (
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              모델
            </label>
            <select
              value={(formData as typeof defaultValue).model}
              onChange={(e) => setFormData({ ...formData, model: e.target.value })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
              <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              프롬프트
            </label>
            <textarea
              value={(formData as typeof defaultValue).prompt}
              onChange={(e) => setFormData({ ...formData, prompt: e.target.value })}
              rows={12}
              className="w-full px-4 py-3 bg-slate-900 border border-slate-600 rounded-lg text-white font-mono text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 resize-y"
              placeholder="프롬프트를 입력하세요..."
            />
            <p className="text-xs text-slate-500 mt-2">
              {((formData as typeof defaultValue).prompt || '').length} 자
            </p>
          </div>

          <div className="flex justify-end">
            <button
              onClick={() => onSave(setting.key, formData as Record<string, unknown>)}
              disabled={saving}
              className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
            >
              {saving ? '저장 중...' : '적용'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// EC2 API 설정 에디터
function EC2ApiEditor({
  setting,
  onSave,
  saving,
}: {
  setting: Setting | undefined
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
}) {
  const defaultValue = {
    base_url: '',
    secret: '',
    description: 'EC2 서버 API 연동 설정',
  }
  
  const [formData, setFormData] = useState(setting?.value || defaultValue)
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showSecret, setShowSecret] = useState(false)

  useEffect(() => {
    if (setting?.value) {
      setFormData(setting.value)
    }
  }, [setting])

  const testConnection = async () => {
    setTestStatus('testing')
    try {
      const response = await fetch(`${(formData as typeof defaultValue).base_url}/health`)
      if (response.ok) {
        setTestStatus('success')
      } else {
        setTestStatus('error')
      }
    } catch {
      setTestStatus('error')
    }
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-semibold text-white">🔗 EC2 API 연동</h3>
        <p className="text-slate-500 text-sm mt-1">
          SERP 크롤링 서버와의 연동 설정입니다.
        </p>
      </div>

      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            API Base URL
          </label>
          <div className="flex gap-2">
            <input
              type="url"
              value={(formData as typeof defaultValue).base_url}
              onChange={(e) => setFormData({ ...formData, base_url: e.target.value })}
              className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="https://example.com"
            />
            <button
              onClick={testConnection}
              disabled={testStatus === 'testing'}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-50"
            >
              {testStatus === 'testing' ? '테스트 중...' : '연결 테스트'}
            </button>
          </div>
          {testStatus === 'success' && (
            <p className="text-emerald-400 text-sm mt-2">✅ 연결 성공</p>
          )}
          {testStatus === 'error' && (
            <p className="text-red-400 text-sm mt-2">❌ 연결 실패</p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            API Secret
          </label>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              value={(formData as typeof defaultValue).secret}
              onChange={(e) => setFormData({ ...formData, secret: e.target.value })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 pr-20"
              placeholder="••••••••"
            />
            <button
              type="button"
              onClick={() => setShowSecret(!showSecret)}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white px-2 py-1 text-sm"
            >
              {showSecret ? '숨기기' : '보기'}
            </button>
          </div>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => onSave('ec2_api', formData as Record<string, unknown>)}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? '저장 중...' : '적용'}
          </button>
        </div>
      </div>
    </div>
  )
}

// Slack 설정 에디터
function SlackSettingsEditor({ 
  setting, 
  onSave,
  saving
}: { 
  setting?: Setting
  onSave: (key: string, value: Record<string, unknown>) => Promise<void>
  saving: boolean
}) {
  const defaultValue = {
    enabled: false,
    webhook_url: '',
    notify_serp_complete: true,
    notify_unexposed_alert: true,
    notify_weekly_report: true,
    description: 'Slack 알림 설정',
  }

  const [formData, setFormData] = useState<typeof defaultValue>(
    setting?.value ? (setting.value as typeof defaultValue) : defaultValue
  )
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle')
  const [showUrl, setShowUrl] = useState(false)

  // Slack 웹훅 테스트
  const testWebhook = async () => {
    if (!formData.webhook_url) return
    setTestStatus('testing')
    
    try {
      const response = await fetch(formData.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: '🔔 SERP Tracker 테스트 알림입니다!',
          blocks: [
            {
              type: 'section',
              text: {
                type: 'mrkdwn',
                text: '*🔔 SERP Tracker 연동 테스트*\n웹훅 연결이 정상적으로 설정되었습니다!'
              }
            }
          ]
        })
      })
      
      if (response.ok) {
        setTestStatus('success')
      } else {
        setTestStatus('error')
      }
    } catch {
      setTestStatus('error')
    }
  }

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
      <div className="px-6 py-4 border-b border-slate-700">
        <h3 className="text-lg font-semibold text-white">💬 Slack 알림 설정</h3>
        <p className="text-slate-500 text-sm mt-1">
          SERP 조회 완료, 미노출 알림 등을 Slack으로 받을 수 있습니다.
        </p>
      </div>

      <div className="p-6 space-y-6">
        {/* 활성화 토글 */}
        <div className="flex items-center justify-between p-4 bg-slate-700/50 rounded-lg">
          <div>
            <p className="text-white font-medium">Slack 알림 활성화</p>
            <p className="text-slate-500 text-sm">알림 수신 여부를 설정합니다</p>
          </div>
          <button
            onClick={() => setFormData({ ...formData, enabled: !formData.enabled })}
            className={`relative w-12 h-6 rounded-full transition ${
              formData.enabled ? 'bg-purple-600' : 'bg-slate-600'
            }`}
          >
            <div className={`absolute w-5 h-5 bg-white rounded-full top-0.5 transition-all ${
              formData.enabled ? 'left-6' : 'left-0.5'
            }`} />
          </button>
        </div>

        {/* 웹훅 URL */}
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Webhook URL
          </label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <input
                type={showUrl ? 'text' : 'password'}
                value={formData.webhook_url}
                onChange={(e) => setFormData({ ...formData, webhook_url: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500 pr-20"
                placeholder="https://hooks.slack.com/services/..."
              />
              <button
                type="button"
                onClick={() => setShowUrl(!showUrl)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white px-2 py-1 text-sm"
              >
                {showUrl ? '숨기기' : '보기'}
              </button>
            </div>
            <button
              onClick={testWebhook}
              disabled={!formData.webhook_url || testStatus === 'testing'}
              className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-50"
            >
              {testStatus === 'testing' ? '전송 중...' : '테스트'}
            </button>
          </div>
          {testStatus === 'success' && (
            <p className="text-emerald-400 text-sm mt-2">✅ 테스트 메시지 전송 성공</p>
          )}
          {testStatus === 'error' && (
            <p className="text-red-400 text-sm mt-2">❌ 전송 실패 - 웹훅 URL을 확인하세요</p>
          )}
          <p className="text-slate-500 text-xs mt-2">
            Slack App에서 Incoming Webhooks를 활성화하고 URL을 복사하세요.
          </p>
        </div>

        {/* 알림 유형 */}
        <div className="space-y-3">
          <p className="text-sm font-medium text-slate-300">알림 유형</p>
          
          <label className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg cursor-pointer hover:bg-slate-700/50">
            <input
              type="checkbox"
              checked={formData.notify_serp_complete}
              onChange={(e) => setFormData({ ...formData, notify_serp_complete: e.target.checked })}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500"
            />
            <div>
              <p className="text-white text-sm">SERP 조회 완료</p>
              <p className="text-slate-500 text-xs">전체 SERP 조회 완료 시 알림</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg cursor-pointer hover:bg-slate-700/50">
            <input
              type="checkbox"
              checked={formData.notify_unexposed_alert}
              onChange={(e) => setFormData({ ...formData, notify_unexposed_alert: e.target.checked })}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500"
            />
            <div>
              <p className="text-white text-sm">미노출 긴급 알림</p>
              <p className="text-slate-500 text-xs">노출 중이던 키워드가 미노출로 변경 시</p>
            </div>
          </label>

          <label className="flex items-center gap-3 p-3 bg-slate-700/30 rounded-lg cursor-pointer hover:bg-slate-700/50">
            <input
              type="checkbox"
              checked={formData.notify_weekly_report}
              onChange={(e) => setFormData({ ...formData, notify_weekly_report: e.target.checked })}
              className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500"
            />
            <div>
              <p className="text-white text-sm">주간 리포트</p>
              <p className="text-slate-500 text-xs">매주 월요일 SERP 요약 리포트</p>
            </div>
          </label>
        </div>

        <div className="flex justify-end">
          <button
            onClick={() => onSave('slack_webhook', formData as Record<string, unknown>)}
            disabled={saving}
            className="px-6 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
          >
            {saving ? '저장 중...' : '저장'}
          </button>
        </div>
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Account, Keyword, Content, SerpResult, Json } from '@/types/database'

// 콘텐츠 + SERP 결과
type ContentWithSerp = Content & {
  account?: Pick<Account, 'id' | 'name' | 'blog_score'> | null
  serp_results: SerpResult[]
}

// 키워드 + 콘텐츠 목록
type KeywordWithContents = Keyword & {
  contents: ContentWithSerp[]
}

// 발행 추천 아이템
interface Recommendation {
  keyword: Keyword
  contents: ContentWithSerp[]
  status: 'urgent' | 'recovery' | 'new'
  reason: string
  recommendedAccount: Account | null
  exposureProb: number
}

interface DailyLimitsSettings {
  high_limit: number
  medium_limit: number  
  low_limit: number
  high_tier_threshold: number
  medium_tier_threshold: number
}

export default function RecommendationsPage() {
  const [recommendations, setRecommendations] = useState<Recommendation[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [dailyLimits, setDailyLimits] = useState<DailyLimitsSettings | null>(null)
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string | null>(null)
  const dataLoadedRef = useRef(false)

  const supabase = createClient()

  // 계정 등급 가져오기
  const getAccountTier = (score: number, settings: DailyLimitsSettings | null) => {
    if (!settings) return 'low'
    if (score >= settings.high_tier_threshold) return 'high'
    if (score >= settings.medium_tier_threshold) return 'medium'
    return 'low'
  }

  // 일일 발행 한도
  const getDailyLimit = (tier: string, settings: DailyLimitsSettings | null) => {
    if (!settings) return 2
    if (tier === 'high') return settings.high_limit
    if (tier === 'medium') return settings.medium_limit
    return settings.low_limit
  }

  // 노출 확률 계산 (계정 지수 + 경쟁도 기반)
  const getExposureProb = (accountScore: number, competition: string, settings: DailyLimitsSettings | null) => {
    const matrix: Record<string, Record<string, number>> = {
      '낮음': { high: 0.95, medium: 0.75, low: 0.50 },
      '중간': { high: 0.80, medium: 0.55, low: 0.30 },
      '높음': { high: 0.60, medium: 0.25, low: 0.10 },
      '알 수 없음': { high: 0.70, medium: 0.45, low: 0.25 },
    }
    const tier = getAccountTier(accountScore, settings)
    return matrix[competition]?.[tier] || 0.3
  }

  // 최적 계정 추천
  const findBestAccount = (
    competition: string,
    allAccounts: Account[]
  ): Account | null => {
    const ranges: Record<string, [number, number]> = {
      '높음': [60, 100],
      '중간': [35, 69],
      '낮음': [0, 34],
      '알 수 없음': [0, 100],
    }

    const [minIdx, maxIdx] = ranges[competition] || [0, 100]
    const candidates = allAccounts.filter(a => a.blog_score >= minIdx && a.blog_score <= maxIdx)
    
    if (candidates.length > 0) {
      return candidates.sort((a, b) => b.blog_score - a.blog_score)[0]
    }

    return allAccounts.sort((a, b) => b.blog_score - a.blog_score)[0] || null
  }

  // 추천 생성
  const generateRecommendations = (
    keywordsWithContents: KeywordWithContents[],
    allAccounts: Account[],
    settings: DailyLimitsSettings | null
  ): Recommendation[] => {
    const recs: Recommendation[] = []

    for (const kw of keywordsWithContents) {
      // 활성 콘텐츠 필터링
      const activeContents = kw.contents.filter(c => c.is_active)
      
      // 활성 콘텐츠 중 노출 중인 것 확인
      const exposedContents = activeContents.filter(c => {
        const pcSerp = c.serp_results?.find(r => r.device === 'PC')
        const moSerp = c.serp_results?.find(r => r.device === 'MO')
        return pcSerp?.is_exposed || moSerp?.is_exposed
      })

      // 비활성 콘텐츠 (미노출로 추적 중지된 것)
      const inactiveContents = kw.contents.filter(c => !c.is_active)

      let status: 'urgent' | 'recovery' | 'new' | null = null
      let reason = ''

      // 케이스 1: 활성 콘텐츠가 있었는데 모두 미노출 → 긴급
      if (activeContents.length > 0 && exposedContents.length === 0) {
        status = 'urgent'
        reason = `${activeContents.length}개 콘텐츠 모두 미노출`
      }
      // 케이스 2: 비활성 콘텐츠만 있음 (이전에 노출됐다가 미노출) → 복구
      else if (activeContents.length === 0 && inactiveContents.length > 0) {
        status = 'recovery'
        reason = `이전 ${inactiveContents.length}개 콘텐츠 미노출 (추적 중지됨)`
      }
      // 케이스 3: 콘텐츠가 아예 없음 → 신규
      else if (kw.contents.length === 0) {
        status = 'new'
        reason = '미발행 키워드 (신규 발행 추천)'
      }

      // 노출 중인 콘텐츠가 있으면 추천하지 않음
      if (!status) continue

      const recommendedAccount = findBestAccount(kw.competition, allAccounts)
      const exposureProb = recommendedAccount 
        ? getExposureProb(recommendedAccount.blog_score, kw.competition, settings)
        : 0.3

      recs.push({
        keyword: kw,
        contents: kw.contents,
        status,
        reason,
        recommendedAccount,
        exposureProb,
      })
    }

    // 검색량 순으로 정렬
    return recs.sort((a, b) => b.keyword.monthly_search_total - a.keyword.monthly_search_total)
  }

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true)

    // 설정 로드
    const { data: settingsData } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'daily_publish_limits')
      .single()
    
    const loadedSettings = settingsData?.value as DailyLimitsSettings | null

    // 마지막 분석 시간 로드
    const { data: lastAnalysis } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'last_analysis_time')
      .single()
    
    if (lastAnalysis?.value) {
      setLastAnalyzedAt((lastAnalysis.value as { timestamp: string }).timestamp)
    }

    // 계정 로드
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('*')
      .order('blog_score', { ascending: false })

    // 키워드 로드
    const { data: keywordsData } = await supabase
      .from('keywords')
      .select('*')
      .order('monthly_search_total', { ascending: false })

    // 콘텐츠 + SERP 로드
    const { data: contentsData } = await supabase
      .from('contents')
      .select(`
        *,
        account:accounts(id, name, blog_score),
        serp_results(*)
      `)

    // 키워드별로 콘텐츠 그룹화
    const keywordsWithContents: KeywordWithContents[] = (keywordsData || []).map(kw => ({
      ...kw,
      contents: (contentsData || [])
        .filter(c => c.keyword_id === kw.id)
        .map(c => ({
          ...c,
          serp_results: (c.serp_results || [])
            .sort((a: SerpResult, b: SerpResult) => 
              new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
            )
            .slice(0, 2)
        }))
    }))

    if (accountsData) {
      const recs = generateRecommendations(
        keywordsWithContents,
        accountsData,
        loadedSettings
      )
      
      setDailyLimits(loadedSettings)
      setAccounts(accountsData || [])
      setRecommendations(recs)
    }

    setLoading(false)
  }, [supabase])

  // 수동 분석 실행
  const runManualAnalysis = useCallback(async () => {
    setAnalyzing(true)

    try {
      // EC2 설정 가져오기
      const { data: ec2Settings } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'ec2_api')
        .single()

      if (ec2Settings?.value) {
        const config = ec2Settings.value as { base_url: string; secret: string }
        
        // EC2 서버에 분석 요청
        try {
          await fetch(`${config.base_url}/run-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: config.secret }),
          })
        } catch (e) {
          console.warn('EC2 서버 연결 실패')
        }
      }

      // 분석 시간 저장
      const now = new Date().toISOString()
      await supabase
        .from('settings')
        .upsert({ 
          key: 'last_analysis_time', 
          value: { timestamp: now } as unknown as Json
        }, { onConflict: 'key' })
      
      setLastAnalyzedAt(now)

      // 데이터 새로고침
      dataLoadedRef.current = false
      await loadData()

    } catch (error) {
      console.error('분석 실행 오류:', error)
    } finally {
      setAnalyzing(false)
    }
  }, [supabase, loadData])

  // 데이터 로드 (한 번만 실행)
  useEffect(() => {
    if (dataLoadedRef.current) return
    dataLoadedRef.current = true
    loadData()
  }, [loadData])

  // 계정별 할당 현황
  const accountAllocation = accounts.map(acc => {
    const tier = getAccountTier(acc.blog_score, dailyLimits)
    const limit = getDailyLimit(tier, dailyLimits)
    const assigned = recommendations.filter(r => r.recommendedAccount?.id === acc.id).length
    return { account: acc, tier, limit, assigned }
  })

  // 상태별 통계
  const stats = {
    urgent: recommendations.filter(r => r.status === 'urgent').length,
    recovery: recommendations.filter(r => r.status === 'recovery').length,
    new: recommendations.filter(r => r.status === 'new').length,
    total: recommendations.length,
  }

  // 시간 포맷
  const formatTime = (isoString: string | null) => {
    if (!isoString) return '분석 기록 없음'
    const date = new Date(isoString)
    return date.toLocaleString('ko-KR', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">발행 추천</h1>
          <p className="text-slate-400 mt-1">미노출 키워드를 분석하여 최적의 발행 전략을 추천합니다</p>
          {lastAnalyzedAt && (
            <p className="text-slate-500 text-sm mt-1">
              마지막 분석: {formatTime(lastAnalyzedAt)}
            </p>
          )}
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => { dataLoadedRef.current = false; loadData() }}
            disabled={loading}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition flex items-center gap-2 disabled:opacity-50"
          >
            🔄 새로고침
          </button>
          <button
            onClick={runManualAnalysis}
            disabled={analyzing || loading}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2 disabled:opacity-50"
          >
            {analyzing ? (
              <>
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                분석 중...
              </>
            ) : (
              <>📊 분석 실행</>
            )}
          </button>
        </div>
      </div>

      {/* 로딩 표시 */}
      {loading ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-12 text-center">
          <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
          <p className="text-slate-400">데이터 분석 중...</p>
        </div>
      ) : (
        <>
          {/* 요약 카드 */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <p className="text-red-400 text-sm">🚨 긴급 복구</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.urgent}</p>
              <p className="text-slate-500 text-xs">활성 콘텐츠 모두 미노출</p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <p className="text-yellow-400 text-sm">⚠️ 복구 필요</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.recovery}</p>
              <p className="text-slate-500 text-xs">이전 콘텐츠 추적 중지됨</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <p className="text-blue-400 text-sm">✨ 신규 추천</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.new}</p>
              <p className="text-slate-500 text-xs">미발행 키워드</p>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
              <p className="text-purple-400 text-sm">📊 전체 추천</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
              <p className="text-slate-500 text-xs">검색량 순 정렬</p>
            </div>
          </div>

          {/* 계정별 할당 현황 */}
          {accountAllocation.length > 0 && (
            <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-white mb-4">📋 계정별 일일 발행 한도</h2>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {accountAllocation.map(({ account, tier, limit, assigned }) => (
                  <div key={account.id} className="bg-slate-700/50 rounded-lg p-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-white font-medium">{account.name}</span>
                      <span className={`text-xs px-2 py-1 rounded ${
                        tier === 'high' ? 'bg-emerald-500/20 text-emerald-400' :
                        tier === 'medium' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-slate-500/20 text-slate-400'
                      }`}>
                        {account.blog_score}점
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-600 rounded-full h-2">
                        <div 
                          className={`h-2 rounded-full ${assigned > limit ? 'bg-red-500' : 'bg-emerald-500'}`}
                          style={{ width: `${Math.min((assigned / limit) * 100, 100)}%` }}
                        />
                      </div>
                      <span className="text-sm text-slate-400">{assigned}/{limit}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 추천 목록 */}
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="text-lg font-semibold text-white">📝 발행 추천 목록</h2>
              <p className="text-slate-500 text-sm">검색량 순으로 정렬됨</p>
            </div>

            {recommendations.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                <p className="text-4xl mb-4">🎉</p>
                <p>추천할 키워드가 없습니다</p>
                <p className="text-sm">모든 키워드가 노출 중이거나, 키워드가 없습니다</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-slate-700/50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">상태</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">키워드</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">검색량</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">경쟁</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">콘텐츠</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">추천 계정</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">노출확률</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">사유</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-700/50">
                    {recommendations.map((rec) => (
                      <tr key={rec.keyword.id} className="hover:bg-slate-700/30">
                        <td className="px-4 py-3">
                          <span className={`px-2 py-1 text-xs rounded ${
                            rec.status === 'urgent' ? 'bg-red-500/20 text-red-400' :
                            rec.status === 'recovery' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-blue-500/20 text-blue-400'
                          }`}>
                            {rec.status === 'urgent' ? '🚨 긴급' : 
                             rec.status === 'recovery' ? '⚠️ 복구' : '✨ 신규'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div>
                            <p className="text-white font-medium">{rec.keyword.keyword}</p>
                            {rec.keyword.sub_keyword && (
                              <p className="text-slate-500 text-xs">{rec.keyword.sub_keyword}</p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <span className="text-white font-mono text-sm">
                            {rec.keyword.monthly_search_total?.toLocaleString() || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`px-2 py-1 text-xs rounded ${
                            rec.keyword.competition === '높음' ? 'bg-red-500/20 text-red-400' :
                            rec.keyword.competition === '중간' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-emerald-500/20 text-emerald-400'
                          }`}>
                            {rec.keyword.competition}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-slate-400 text-sm">
                            {rec.contents.length}개
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-purple-400 font-medium text-sm">
                            {rec.recommendedAccount?.name || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-12 bg-slate-700 rounded-full h-2">
                              <div 
                                className="h-2 rounded-full bg-emerald-500"
                                style={{ width: `${rec.exposureProb * 100}%` }}
                              />
                            </div>
                            <span className="text-slate-400 text-xs">{Math.round(rec.exposureProb * 100)}%</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-slate-500 text-xs">{rec.reason}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Account, Keyword, SerpResult } from '@/types/database'

type KeywordWithSerp = Keyword & {
  account: Pick<Account, 'id' | 'name' | 'blog_score'> | null
  serp_results: SerpResult[]
}

interface Recommendation {
  keyword: KeywordWithSerp
  status: 'urgent' | 'recovery' | 'new'
  reason: string
  recommendedAccount: Account | null
  expectedImpact: number
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
  const [dailyLimits, setDailyLimits] = useState<DailyLimitsSettings | null>(null)
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

  // 노출 확률 계산
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

  // 기대 효과 점수 계산
  const calcExpectedImpact = (
    exposureProb: number,
    totalVolume: number,
    status: 'urgent' | 'recovery' | 'new'
  ) => {
    const volumeValue = totalVolume > 0 ? Math.log10(totalVolume + 10) : 0.5
    const statusWeight = status === 'urgent' ? 2.0 : status === 'recovery' ? 1.5 : 1.0
    return Math.round(exposureProb * volumeValue * statusWeight * 100)
  }

  // 최적 계정 추천
  const findBestAccount = (
    competition: string,
    originalAccount: Account | null,
    allAccounts: Account[],
    status: 'urgent' | 'recovery' | 'new'
  ): Account | null => {
    if ((status === 'urgent' || status === 'recovery') && originalAccount) {
      return originalAccount
    }

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

  // 추천 생성 (순수 함수로 변경)
  const generateRecommendations = (
    keywords: KeywordWithSerp[],
    allAccounts: Account[],
    settings: DailyLimitsSettings | null
  ): Recommendation[] => {
    const recs: Recommendation[] = []

    for (const kw of keywords) {
      const pcSerp = kw.serp_results?.find(r => r.device === 'PC')
      const moSerp = kw.serp_results?.find(r => r.device === 'MO')
      
      const pcRank = pcSerp?.rank ?? null
      const moRank = moSerp?.rank ?? null
      const pcChange = pcSerp?.rank_change || 0
      const moChange = moSerp?.rank_change || 0
      
      const isUnexposed = pcRank === null && moRank === null
      const wasExposed = pcChange < -10 || moChange < -10

      let status: 'urgent' | 'recovery' | 'new' | null = null
      let reason = ''

      if (isUnexposed && wasExposed) {
        status = 'urgent'
        reason = '이전 노출 → 미노출 (긴급 복구 필요)'
      } else if (isUnexposed && kw.url) {
        status = 'recovery'
        reason = 'URL 있으나 미노출 (복구 필요)'
      } else if (!kw.url) {
        status = 'new'
        reason = '미발행 키워드 (신규 발행 추천)'
      }

      if (!status) continue

      const accountScore = kw.account?.blog_score || 0
      const exposureProb = getExposureProb(accountScore, kw.competition, settings)
      const expectedImpact = calcExpectedImpact(exposureProb, kw.monthly_search_total, status)

      const recommendedAccount = findBestAccount(
        kw.competition,
        kw.account as Account | null,
        allAccounts,
        status
      )

      recs.push({
        keyword: kw,
        status,
        reason,
        recommendedAccount,
        expectedImpact,
        exposureProb,
      })
    }

    return recs.sort((a, b) => b.expectedImpact - a.expectedImpact)
  }

  // 데이터 로드 (한 번만 실행)
  useEffect(() => {
    if (dataLoadedRef.current) return
    dataLoadedRef.current = true

    const loadData = async () => {
      setLoading(true)

      // 설정 로드
      const { data: settingsData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'daily_publish_limits')
        .single()
      
      const loadedSettings = settingsData?.value as DailyLimitsSettings | null

      // 계정 로드
      const { data: accountsData } = await supabase
        .from('accounts')
        .select('*')
        .order('blog_score', { ascending: false })

      // 키워드 + SERP 로드
      const { data: keywordsData } = await supabase
        .from('keywords')
        .select(`
          *,
          account:accounts(id, name, blog_score),
          serp_results(*)
        `)
        .order('monthly_search_total', { ascending: false })

      if (keywordsData && accountsData) {
        const processed = keywordsData.map(kw => ({
          ...kw,
          serp_results: (kw.serp_results || [])
            .sort((a: SerpResult, b: SerpResult) => 
              new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
            )
            .slice(0, 2)
        }))
        
        const recs = generateRecommendations(
          processed as KeywordWithSerp[], 
          accountsData, 
          loadedSettings
        )
        
        setDailyLimits(loadedSettings)
        setAccounts(accountsData || [])
        setRecommendations(recs)
      }

      setLoading(false)
    }

    loadData()
  }, [supabase])

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

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-white">발행 추천</h1>
        <p className="text-slate-400 mt-1">미노출 키워드를 분석하여 최적의 발행 전략을 추천합니다</p>
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
              <p className="text-slate-500 text-xs">이전 노출 → 미노출</p>
            </div>
            <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-4">
              <p className="text-yellow-400 text-sm">⚠️ 복구 필요</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.recovery}</p>
              <p className="text-slate-500 text-xs">URL 있으나 미노출</p>
            </div>
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
              <p className="text-blue-400 text-sm">✨ 신규 추천</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.new}</p>
              <p className="text-slate-500 text-xs">미발행 키워드</p>
            </div>
            <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
              <p className="text-purple-400 text-sm">📊 전체 추천</p>
              <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
              <p className="text-slate-500 text-xs">기대효과 순 정렬</p>
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
              <p className="text-slate-500 text-sm">기대효과 점수 순으로 정렬됨</p>
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
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">현재 계정</th>
                      <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">추천 계정</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">노출확률</th>
                      <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">기대효과</th>
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
                        <td className="px-4 py-3">
                          <span className="text-slate-400 text-sm">
                            {rec.keyword.account?.name || '-'}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-sm font-medium ${
                            rec.recommendedAccount?.id !== rec.keyword.account?.id 
                              ? 'text-purple-400' 
                              : 'text-slate-400'
                          }`}>
                            {rec.recommendedAccount?.name || '-'}
                            {rec.recommendedAccount?.id !== rec.keyword.account?.id && ' ⬅️'}
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
                        <td className="px-4 py-3 text-center">
                          <span className={`font-bold ${
                            rec.expectedImpact >= 200 ? 'text-emerald-400' :
                            rec.expectedImpact >= 100 ? 'text-yellow-400' :
                            'text-slate-400'
                          }`}>
                            {rec.expectedImpact}
                          </span>
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

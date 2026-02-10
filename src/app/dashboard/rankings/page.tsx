'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Keyword, SerpResult } from '@/types/database'

type KeywordWithSerp = Keyword & {
  account: { name: string } | null
  serp_results: SerpResult[]
}

interface RankingData {
  keyword: KeywordWithSerp
  pcRank: number | null
  moRank: number | null
  pcChange: number
  moChange: number
  capturedAt: string
}

export default function RankingsPage() {
  const [rankings, setRankings] = useState<RankingData[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'up' | 'down' | 'new' | 'lost'>('all')
  const [sortBy, setSortBy] = useState<'change' | 'volume' | 'rank'>('change')

  const supabase = createClient()

  useEffect(() => {
    const loadData = async () => {
      setLoading(true)

      const { data } = await supabase
        .from('keywords')
        .select(`
          *,
          account:accounts(name),
          serp_results(*)
        `)
        .order('monthly_search_total', { ascending: false })

      if (data) {
        const processed: RankingData[] = data.map(kw => {
          const latestSerp = (kw.serp_results || [])
            .sort((a: SerpResult, b: SerpResult) => 
              new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
            )

          const pcSerp = latestSerp.find((s: SerpResult) => s.device === 'PC')
          const moSerp = latestSerp.find((s: SerpResult) => s.device === 'MO')

          return {
            keyword: kw as KeywordWithSerp,
            pcRank: pcSerp?.rank ?? null,
            moRank: moSerp?.rank ?? null,
            pcChange: pcSerp?.rank_change ?? 0,
            moChange: moSerp?.rank_change ?? 0,
            capturedAt: pcSerp?.captured_at || moSerp?.captured_at || '',
          }
        })

        setRankings(processed)
      }

      setLoading(false)
    }

    loadData()
  }, [supabase])

  // 필터링
  const filteredRankings = rankings.filter(r => {
    if (filter === 'all') return true
    if (filter === 'up') return r.pcChange > 0 || r.moChange > 0
    if (filter === 'down') return r.pcChange < 0 || r.moChange < 0
    if (filter === 'new') return (r.pcRank !== null || r.moRank !== null) && r.capturedAt === new Date().toISOString().split('T')[0]
    if (filter === 'lost') return r.pcRank === null && r.moRank === null && (r.pcChange < -10 || r.moChange < -10)
    return true
  })

  // 정렬
  const sortedRankings = [...filteredRankings].sort((a, b) => {
    if (sortBy === 'change') {
      const aChange = Math.abs(a.pcChange) + Math.abs(a.moChange)
      const bChange = Math.abs(b.pcChange) + Math.abs(b.moChange)
      return bChange - aChange
    }
    if (sortBy === 'volume') {
      return (b.keyword.monthly_search_total || 0) - (a.keyword.monthly_search_total || 0)
    }
    if (sortBy === 'rank') {
      const aRank = a.pcRank ?? a.moRank ?? 999
      const bRank = b.pcRank ?? b.moRank ?? 999
      return aRank - bRank
    }
    return 0
  })

  // 통계
  const stats = {
    total: rankings.length,
    exposed: rankings.filter(r => r.pcRank !== null || r.moRank !== null).length,
    up: rankings.filter(r => r.pcChange > 0 || r.moChange > 0).length,
    down: rankings.filter(r => r.pcChange < 0 || r.moChange < 0).length,
    lost: rankings.filter(r => r.pcRank === null && r.moRank === null && (r.pcChange < -10 || r.moChange < -10)).length,
  }

  // Top 상승/하락
  const topUp = [...rankings]
    .filter(r => r.pcChange > 0 || r.moChange > 0)
    .sort((a, b) => (b.pcChange + b.moChange) - (a.pcChange + a.moChange))
    .slice(0, 5)

  const topDown = [...rankings]
    .filter(r => r.pcChange < 0 || r.moChange < 0)
    .sort((a, b) => (a.pcChange + a.moChange) - (b.pcChange + b.moChange))
    .slice(0, 5)

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div>
        <h1 className="text-2xl font-bold text-white">순위 변동</h1>
        <p className="text-slate-400 mt-1">키워드별 SERP 순위 변동을 확인합니다</p>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <p className="text-slate-400 text-sm">전체 키워드</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
          <p className="text-emerald-400 text-sm">노출 중</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.exposed}</p>
          <p className="text-slate-500 text-xs">{stats.total > 0 ? Math.round((stats.exposed / stats.total) * 100) : 0}%</p>
        </div>
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
          <p className="text-green-400 text-sm">↑ 상승</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.up}</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 text-sm">↓ 하락</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.down}</p>
        </div>
        <div className="bg-orange-500/10 border border-orange-500/30 rounded-xl p-4">
          <p className="text-orange-400 text-sm">⚠️ 이탈</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.lost}</p>
        </div>
      </div>

      {/* Top 상승/하락 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Top 상승 */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 bg-green-500/5">
            <h2 className="text-lg font-semibold text-green-400">🚀 Top 5 상승</h2>
          </div>
          <div className="divide-y divide-slate-700/50">
            {topUp.length === 0 ? (
              <div className="p-6 text-center text-slate-500">상승 키워드 없음</div>
            ) : (
              topUp.map((r, idx) => (
                <div key={r.keyword.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-slate-600">#{idx + 1}</span>
                    <div>
                      <p className="text-white font-medium">{r.keyword.keyword}</p>
                      <p className="text-slate-500 text-xs">{r.keyword.account?.name || '미지정'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      {r.pcChange > 0 && (
                        <span className="text-green-400 text-sm font-mono">PC↑{r.pcChange}</span>
                      )}
                      {r.moChange > 0 && (
                        <span className="text-green-400 text-sm font-mono">MO↑{r.moChange}</span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs">
                      현재: PC {r.pcRank ?? '-'} / MO {r.moRank ?? '-'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Top 하락 */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 bg-red-500/5">
            <h2 className="text-lg font-semibold text-red-400">📉 Top 5 하락</h2>
          </div>
          <div className="divide-y divide-slate-700/50">
            {topDown.length === 0 ? (
              <div className="p-6 text-center text-slate-500">하락 키워드 없음</div>
            ) : (
              topDown.map((r, idx) => (
                <div key={r.keyword.id} className="px-6 py-4 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <span className="text-2xl font-bold text-slate-600">#{idx + 1}</span>
                    <div>
                      <p className="text-white font-medium">{r.keyword.keyword}</p>
                      <p className="text-slate-500 text-xs">{r.keyword.account?.name || '미지정'}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-2">
                      {r.pcChange < 0 && (
                        <span className="text-red-400 text-sm font-mono">PC↓{Math.abs(r.pcChange)}</span>
                      )}
                      {r.moChange < 0 && (
                        <span className="text-red-400 text-sm font-mono">MO↓{Math.abs(r.moChange)}</span>
                      )}
                    </div>
                    <p className="text-slate-500 text-xs">
                      현재: PC {r.pcRank ?? '미노출'} / MO {r.moRank ?? '미노출'}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 필터 & 정렬 */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm">필터:</span>
          {[
            { key: 'all', label: '전체' },
            { key: 'up', label: '상승' },
            { key: 'down', label: '하락' },
            { key: 'lost', label: '이탈' },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key as typeof filter)}
              className={`px-3 py-1 text-sm rounded-lg transition ${
                filter === f.key
                  ? 'bg-purple-600 text-white'
                  : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-slate-400 text-sm">정렬:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-1 bg-slate-700 border border-slate-600 rounded-lg text-white text-sm"
          >
            <option value="change">변동폭</option>
            <option value="volume">검색량</option>
            <option value="rank">순위</option>
          </select>
        </div>
      </div>

      {/* 전체 목록 */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            로딩 중...
          </div>
        ) : sortedRankings.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            해당하는 키워드가 없습니다
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">키워드</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">계정</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">검색량</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">PC 순위</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">PC 변동</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">MO 순위</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">MO 변동</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">측정일</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {sortedRankings.map((r) => (
                  <tr key={r.keyword.id} className="hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-white font-medium">{r.keyword.keyword}</p>
                        {r.keyword.sub_keyword && (
                          <p className="text-slate-500 text-xs">{r.keyword.sub_keyword}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-sm">{r.keyword.account?.name || '-'}</span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white font-mono text-sm">
                        {r.keyword.monthly_search_total?.toLocaleString() || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-mono ${r.pcRank ? 'text-white' : 'text-slate-500'}`}>
                        {r.pcRank ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ChangeCell change={r.pcChange} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`font-mono ${r.moRank ? 'text-white' : 'text-slate-500'}`}>
                        {r.moRank ?? '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <ChangeCell change={r.moChange} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-slate-500 text-sm">{r.capturedAt || '-'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function ChangeCell({ change }: { change: number }) {
  if (change === 0) {
    return <span className="text-slate-500">-</span>
  }
  if (change > 0) {
    return <span className="text-green-400 font-mono">↑{change}</span>
  }
  return <span className="text-red-400 font-mono">↓{Math.abs(change)}</span>
}

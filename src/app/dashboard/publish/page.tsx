'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Keyword, Content, Account, SerpResult } from '@/types/database'

// 콘텐츠 + 키워드 + 계정 + SERP (V2 구조)
type ContentWithRelations = Content & {
  keyword?: Pick<Keyword, 'id' | 'keyword' | 'sub_keyword' | 'monthly_search_total' | 'competition' | 'mobile_ratio'>
  account?: Pick<Account, 'id' | 'name'> | null
  serp_results: SerpResult[]
}

export default function PublishPage() {
  const [contents, setContents] = useState<ContentWithRelations[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState({
    account: '',
    keyword: '',
    exposed: 'all' as 'all' | 'exposed' | 'unexposed'
  })
  const [sortBy, setSortBy] = useState<'date' | 'volume' | 'rank'>('date')
  
  const supabase = createClient()

  // 데이터 로드 (V2 구조: contents 테이블 기반)
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    // 계정 로드
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('*')
      .order('name')
    
    setAccounts(accountsData || [])
    
    // 콘텐츠 + 키워드 + 계정 + SERP 로드
    const { data, error: err } = await supabase
      .from('contents')
      .select(`
        *,
        keyword:keywords(id, keyword, sub_keyword, monthly_search_total, competition, mobile_ratio),
        account:accounts(id, name),
        serp_results(*)
      `)
      .order('published_date', { ascending: false })
      .limit(500)
    
    if (err) {
      setError('데이터 로드 실패: ' + err.message)
      setContents([])
    } else {
      // 콘텐츠 데이터 가공
      let processed = (data || []).map(c => ({
        ...c,
        serp_results: (c.serp_results || [])
          .sort((a: SerpResult, b: SerpResult) => 
            new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
          )
          .slice(0, 2) // PC, MO 최신 결과만
      })) as ContentWithRelations[]
      
      // 계정 필터
      if (filter.account) {
        processed = processed.filter(c => c.account?.id === filter.account)
      }
      
      // 키워드/제목 필터
      if (filter.keyword) {
        const searchLower = filter.keyword.toLowerCase()
        processed = processed.filter(c => 
          c.keyword?.keyword?.toLowerCase().includes(searchLower) ||
          c.keyword?.sub_keyword?.toLowerCase().includes(searchLower) ||
          c.title?.toLowerCase().includes(searchLower)
        )
      }
      
      // 노출 필터
      if (filter.exposed === 'exposed') {
        processed = processed.filter(c => {
          const pcSerp = c.serp_results?.find(r => r.device === 'PC')
          const moSerp = c.serp_results?.find(r => r.device === 'MO')
          return pcSerp?.rank !== null || moSerp?.rank !== null
        })
      } else if (filter.exposed === 'unexposed') {
        processed = processed.filter(c => {
          const pcSerp = c.serp_results?.find(r => r.device === 'PC')
          const moSerp = c.serp_results?.find(r => r.device === 'MO')
          return (pcSerp?.rank === null || pcSerp?.rank === undefined) && 
                 (moSerp?.rank === null || moSerp?.rank === undefined)
        })
      }
      
      // 정렬
      if (sortBy === 'volume') {
        processed = processed.sort((a, b) => 
          (b.keyword?.monthly_search_total || 0) - (a.keyword?.monthly_search_total || 0)
        )
      } else if (sortBy === 'rank') {
        processed = processed.sort((a, b) => {
          const aRank = Math.min(
            a.serp_results?.find(r => r.device === 'PC')?.rank ?? 999,
            a.serp_results?.find(r => r.device === 'MO')?.rank ?? 999
          )
          const bRank = Math.min(
            b.serp_results?.find(r => r.device === 'PC')?.rank ?? 999,
            b.serp_results?.find(r => r.device === 'MO')?.rank ?? 999
          )
          return aRank - bRank
        })
      }
      
      setContents(processed)
    }
    
    setLoading(false)
  }, [supabase, filter, sortBy])

  useEffect(() => {
    loadData()
  }, [loadData])

  // SERP 결과에서 순위 가져오기
  const getRankInfo = (content: ContentWithRelations, device: 'PC' | 'MO') => {
    const serp = content.serp_results?.find(r => r.device === device)
    return {
      rank: serp?.rank ?? null,
      change: serp?.rank_change ?? 0
    }
  }

  // 통계
  const stats = {
    total: contents.length,
    exposed: contents.filter(c => {
      const pc = getRankInfo(c, 'PC')
      const mo = getRankInfo(c, 'MO')
      return pc.rank !== null || mo.rank !== null
    }).length,
    unexposed: contents.filter(c => {
      const pc = getRankInfo(c, 'PC')
      const mo = getRankInfo(c, 'MO')
      return pc.rank === null && mo.rank === null
    }).length,
    camfit: contents.filter(c => c.camfit_link).length,
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">발행 콘텐츠</h1>
          <p className="text-slate-400 mt-1">
            총 {stats.total}개 · 노출 {stats.exposed}개 · 미노출 {stats.unexposed}개
          </p>
        </div>
        <button
          onClick={loadData}
          disabled={loading}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50"
        >
          {loading ? '로딩 중...' : '🔄 새로고침'}
        </button>
      </div>

      {/* 통계 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-slate-800/50 border border-slate-700 rounded-xl p-4">
          <p className="text-slate-400 text-sm">전체 콘텐츠</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.total}</p>
        </div>
        <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-4">
          <p className="text-emerald-400 text-sm">노출 중</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.exposed}</p>
          <p className="text-slate-500 text-xs">{stats.total > 0 ? Math.round((stats.exposed / stats.total) * 100) : 0}%</p>
        </div>
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
          <p className="text-red-400 text-sm">미노출</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.unexposed}</p>
        </div>
        <div className="bg-blue-500/10 border border-blue-500/30 rounded-xl p-4">
          <p className="text-blue-400 text-sm">캠핏 링크</p>
          <p className="text-2xl font-bold text-white mt-1">{stats.camfit}</p>
        </div>
      </div>

      {/* 필터 */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex-1 min-w-[200px]">
            <input
              type="text"
              placeholder="🔍 키워드/제목 검색..."
              value={filter.keyword}
              onChange={(e) => setFilter({ ...filter, keyword: e.target.value })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>
          <select
            value={filter.account}
            onChange={(e) => setFilter({ ...filter, account: e.target.value })}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="">전체 계정</option>
            {accounts.map(acc => (
              <option key={acc.id} value={acc.id}>{acc.name}</option>
            ))}
          </select>
          <select
            value={filter.exposed}
            onChange={(e) => setFilter({ ...filter, exposed: e.target.value as typeof filter.exposed })}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="all">전체</option>
            <option value="exposed">노출만</option>
            <option value="unexposed">미노출만</option>
          </select>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
          >
            <option value="date">발행일순</option>
            <option value="volume">검색량순</option>
            <option value="rank">순위순</option>
          </select>
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 text-red-400">
          {error}
        </div>
      )}

      {/* 테이블 */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            로딩 중...
          </div>
        ) : contents.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <p className="text-4xl mb-4">📝</p>
            <p>발행된 콘텐츠가 없습니다</p>
            <p className="text-sm mt-2">키워드 관리에서 콘텐츠를 추가하세요</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">발행일</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">계정</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">키워드</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-slate-400 uppercase">제목</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">PC</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">MO</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-slate-400 uppercase">검색량</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {contents.map((content) => {
                  const pcInfo = getRankInfo(content, 'PC')
                  const moInfo = getRankInfo(content, 'MO')
                  
                  return (
                    <tr key={content.id} className="hover:bg-slate-700/30">
                      <td className="px-4 py-3">
                        <span className="text-slate-400 text-sm">
                          {content.published_date || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                          {content.account?.name || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div>
                          <p className="text-white text-sm">{content.keyword?.keyword || '-'}</p>
                          {content.keyword?.sub_keyword && (
                            <p className="text-slate-500 text-xs">{content.keyword.sub_keyword}</p>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 max-w-[300px]">
                        {content.url ? (
                          <a 
                            href={content.url} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="text-purple-400 hover:text-purple-300 text-sm truncate block"
                            title={content.title || content.url}
                          >
                            {content.title ? content.title.substring(0, 40) + '...' : '링크'}
                          </a>
                        ) : (
                          <span className="text-slate-400 text-sm truncate block">
                            {content.title ? content.title.substring(0, 40) + '...' : '-'}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <RankBadge rank={pcInfo.rank} change={pcInfo.change} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <RankBadge rank={moInfo.rank} change={moInfo.change} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className="text-white font-mono text-sm">
                          {content.keyword?.monthly_search_total?.toLocaleString() || '-'}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {content.is_active ? (
                          <span className="text-emerald-400 text-xs">추적 중</span>
                        ) : (
                          <span className="text-slate-500 text-xs">중지됨</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

function RankBadge({ rank, change }: { rank: number | null; change: number }) {
  if (rank === null) {
    return <span className="text-slate-500 text-sm">미노출</span>
  }
  
  return (
    <div className="flex items-center justify-center gap-1">
      <span className={`font-mono text-sm ${rank <= 5 ? 'text-emerald-400' : rank <= 10 ? 'text-yellow-400' : 'text-white'}`}>
        {rank}
      </span>
      {change !== 0 && (
        <span className={`text-xs ${change > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {change > 0 ? `↑${change}` : `↓${Math.abs(change)}`}
        </span>
      )}
    </div>
  )
}

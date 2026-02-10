'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'

interface PublishRecord {
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
}

export default function PublishPage() {
  const [records, setRecords] = useState<PublishRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState({
    account: '',
    keyword: '',
    exposed: 'all' as 'all' | 'exposed' | 'unexposed'
  })
  const [sortBy, setSortBy] = useState<'date' | 'volume' | 'rank'>('date')
  
  const supabase = createClient()

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true)
    setError(null)
    
    let query = supabase
      .from('publish_records')
      .select('*')
      .order('published_date', { ascending: false })
      .limit(500)
    
    if (filter.account) {
      query = query.eq('account_name', filter.account)
    }
    if (filter.keyword) {
      query = query.or(`main_keyword.ilike.%${filter.keyword}%,sub_keyword.ilike.%${filter.keyword}%,title.ilike.%${filter.keyword}%`)
    }
    
    const { data, error: err } = await query
    
    if (err) {
      setError('데이터 로드 실패: ' + err.message)
      setRecords([])
    } else {
      let filtered = data || []
      
      // 노출 필터
      if (filter.exposed === 'exposed') {
        filtered = filtered.filter(r => r.rank_pc !== null || r.rank_mo !== null)
      } else if (filter.exposed === 'unexposed') {
        filtered = filtered.filter(r => r.rank_pc === null && r.rank_mo === null)
      }
      
      // 정렬
      if (sortBy === 'volume') {
        filtered = filtered.sort((a, b) => b.search_total - a.search_total)
      } else if (sortBy === 'rank') {
        filtered = filtered.sort((a, b) => {
          const aRank = Math.min(a.rank_pc ?? 999, a.rank_mo ?? 999)
          const bRank = Math.min(b.rank_pc ?? 999, b.rank_mo ?? 999)
          return aRank - bRank
        })
      }
      
      setRecords(filtered)
    }
    
    setLoading(false)
  }, [supabase, filter, sortBy])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 고유 계정 목록
  const accountList = [...new Set(records.map(r => r.account_name))].filter(Boolean).sort()

  // 통계
  const stats = {
    total: records.length,
    exposed: records.filter(r => r.rank_pc !== null || r.rank_mo !== null).length,
    unexposed: records.filter(r => r.rank_pc === null && r.rank_mo === null).length,
    camfit: records.filter(r => r.camfit_link).length,
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">발행 기록</h1>
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
          <p className="text-slate-400 text-sm">전체 발행</p>
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
            {accountList.map(acc => (
              <option key={acc} value={acc}>{acc}</option>
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
        ) : records.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <p className="text-4xl mb-4">📝</p>
            <p>발행 기록이 없습니다</p>
            <p className="text-sm mt-2">데이터 마이그레이션이 필요할 수 있습니다</p>
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
                  <th className="px-4 py-3 text-center text-xs font-medium text-slate-400 uppercase">캠핏</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {records.map((record) => (
                  <tr key={record.id} className="hover:bg-slate-700/30">
                    <td className="px-4 py-3">
                      <span className="text-slate-400 text-sm">
                        {record.published_date || '-'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                        {record.account_name}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div>
                        <p className="text-white text-sm">{record.main_keyword}</p>
                        {record.sub_keyword && (
                          <p className="text-slate-500 text-xs">{record.sub_keyword}</p>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 max-w-[300px]">
                      {record.url ? (
                        <a 
                          href={record.url} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300 text-sm truncate block"
                          title={record.title}
                        >
                          {record.title.substring(0, 40)}...
                        </a>
                      ) : (
                        <span className="text-slate-400 text-sm truncate block">{record.title.substring(0, 40)}...</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <RankBadge rank={record.rank_pc} change={record.rank_change_pc} />
                    </td>
                    <td className="px-4 py-3 text-center">
                      <RankBadge rank={record.rank_mo} change={record.rank_change_mo} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className="text-white font-mono text-sm">
                        {record.search_total.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {record.camfit_link ? (
                        <span className="text-emerald-400">✓</span>
                      ) : (
                        <span className="text-slate-500">-</span>
                      )}
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

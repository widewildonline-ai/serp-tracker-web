'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Account, Keyword, SerpResult } from '@/types/database'

type AccountWithStats = Account & {
  keywords: (Keyword & { serp_results: SerpResult[] })[]
}

export default function AccountsPage() {
  const [accounts, setAccounts] = useState<AccountWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingAccount, setEditingAccount] = useState<Account | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [calculating, setCalculating] = useState(false)
  
  const supabase = createClient()

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true)
    
    const { data, error } = await supabase
      .from('accounts')
      .select(`
        *,
        keywords(
          *,
          serp_results(*)
        )
      `)
      .order('blog_score', { ascending: false })
    
    if (error) {
      setError('데이터 로드 실패')
    } else {
      setAccounts((data as AccountWithStats[]) || [])
    }
    
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // 계정 삭제
  const handleDelete = async (account: Account) => {
    // 키워드 확인
    const acc = accounts.find(a => a.id === account.id)
    if (acc && acc.keywords && acc.keywords.length > 0) {
      setError(`"${account.name}" 계정에 ${acc.keywords.length}개의 키워드가 연결되어 있어 삭제할 수 없습니다.`)
      return
    }

    if (!confirm(`"${account.name}" 계정을 삭제하시겠습니까?`)) return

    const { error } = await supabase.from('accounts').delete().eq('id', account.id)

    if (error) {
      setError('삭제 실패: ' + error.message)
    } else {
      setSuccess('계정이 삭제되었습니다.')
      loadData()
    }
  }

  // 알림 자동 숨김
  useEffect(() => {
    if (error || success) {
      const timer = setTimeout(() => {
        setError(null)
        setSuccess(null)
      }, 5000)
      return () => clearTimeout(timer)
    }
  }, [error, success])

  // 블로그 지수 자동 계산
  // 공식: blog_score = (노출키워드비율 × 40) + (평균순위점수 × 30) + (키워드품질 × 30)
  const calcBlogScore = async () => {
    if (!confirm('모든 계정의 블로그 지수를 SERP 데이터 기반으로 재계산합니다.\n\n계속하시겠습니까?')) return

    setCalculating(true)
    try {
      for (const account of accounts) {
        const keywords = account.keywords || []
        if (keywords.length === 0) continue

        let exposedCount = 0
        let totalRankScore = 0
        let totalQualityScore = 0
        
        keywords.forEach(kw => {
          const latestSerp = (kw.serp_results || [])
            .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
          
          const pcSerp = latestSerp.find(s => s.device === 'PC')
          const moSerp = latestSerp.find(s => s.device === 'MO')
          
          const pcRank = pcSerp?.rank ?? null
          const moRank = moSerp?.rank ?? null
          const bestRank = Math.min(pcRank ?? 999, moRank ?? 999)

          // 노출 여부
          if (pcRank !== null || moRank !== null) {
            exposedCount++
            // 순위 점수 (1위=100, 20위=5, 미노출=0)
            if (bestRank < 999) {
              totalRankScore += Math.max(0, 100 - (bestRank - 1) * 5)
            }
          }

          // 키워드 품질 (opportunity_score 활용)
          totalQualityScore += kw.opportunity_score || 50
        })

        // 지표 계산
        const exposureRate = keywords.length > 0 ? (exposedCount / keywords.length) * 100 : 0
        const avgRankScore = exposedCount > 0 ? totalRankScore / exposedCount : 0
        const avgQualityScore = keywords.length > 0 ? totalQualityScore / keywords.length : 50

        // 최종 블로그 지수 (0-100)
        const blogScore = Math.round(
          (exposureRate * 0.4) + 
          (avgRankScore * 0.3) + 
          (avgQualityScore * 0.3)
        )

        await supabase.from('accounts').update({
          blog_score: Math.min(100, Math.max(0, blogScore)),
          updated_at: new Date().toISOString()
        }).eq('id', account.id)
      }

      setSuccess('모든 계정의 블로그 지수가 재계산되었습니다.')
      loadData()
    } catch (err) {
      setError('블로그 지수 계산 실패')
    } finally {
      setCalculating(false)
    }
  }

  // 통계 계산
  const getAccountStats = (account: AccountWithStats) => {
    const keywords = account.keywords || []
    const totalKeywords = keywords.length
    
    let exposedCount = 0
    let totalUp = 0
    let totalDown = 0

    keywords.forEach(kw => {
      const latestSerp = (kw.serp_results || [])
        .sort((a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime())
      
      const pcSerp = latestSerp.find(s => s.device === 'PC')
      const moSerp = latestSerp.find(s => s.device === 'MO')

      if (pcSerp?.rank || moSerp?.rank) exposedCount++
      if ((pcSerp?.rank_change || 0) > 0 || (moSerp?.rank_change || 0) > 0) totalUp++
      if ((pcSerp?.rank_change || 0) < 0 || (moSerp?.rank_change || 0) < 0) totalDown++
    })

    return {
      totalKeywords,
      exposedCount,
      exposureRate: totalKeywords > 0 ? Math.round((exposedCount / totalKeywords) * 100) : 0,
      totalUp,
      totalDown,
    }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">계정 관리</h1>
          <p className="text-slate-400 mt-1">{accounts.length}개 계정</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={calcBlogScore}
            disabled={calculating || accounts.length === 0}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition flex items-center gap-2 disabled:opacity-50"
          >
            {calculating ? '계산 중...' : '📊 지수 재계산'}
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition flex items-center gap-2"
          >
            ➕ 계정 추가
          </button>
        </div>
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

      {/* 계정 카드 */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-12 text-center">
          <p className="text-4xl mb-4">👤</p>
          <p className="text-slate-400">등록된 계정이 없습니다</p>
          <button
            onClick={() => setShowModal(true)}
            className="mt-4 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition"
          >
            첫 계정 추가하기
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((account) => {
            const stats = getAccountStats(account)
            const tier = account.blog_score >= 70 ? 'high' : account.blog_score >= 40 ? 'medium' : 'low'
            
            return (
              <div key={account.id} className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden hover:border-slate-600 transition">
                <div className="p-6">
                  {/* 헤더 */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl ${
                        tier === 'high' ? 'bg-emerald-500/20' :
                        tier === 'medium' ? 'bg-yellow-500/20' : 'bg-slate-500/20'
                      }`}>
                        {account.platform === 'naver' ? '📝' : '🌐'}
                      </div>
                      <div>
                        <h3 className="text-white font-semibold">{account.name}</h3>
                        <p className="text-slate-500 text-sm">{account.platform}</p>
                      </div>
                    </div>
                    <div className="flex gap-1">
                      <button
                        onClick={() => { setEditingAccount(account); setShowModal(true) }}
                        className="p-2 text-slate-400 hover:text-purple-400 transition"
                      >
                        ✏️
                      </button>
                      <button
                        onClick={() => handleDelete(account)}
                        className="p-2 text-slate-400 hover:text-red-400 transition"
                      >
                        🗑️
                      </button>
                    </div>
                  </div>

                  {/* 블로그 지수 */}
                  <div className="mb-4">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-slate-400 text-sm">블로그 지수</span>
                      <span className={`font-bold ${
                        tier === 'high' ? 'text-emerald-400' :
                        tier === 'medium' ? 'text-yellow-400' : 'text-slate-400'
                      }`}>
                        {account.blog_score}점
                      </span>
                    </div>
                    <div className="w-full bg-slate-700 rounded-full h-2">
                      <div className={`h-2 rounded-full ${
                        tier === 'high' ? 'bg-emerald-500' :
                        tier === 'medium' ? 'bg-yellow-500' : 'bg-slate-500'
                      }`} style={{ width: `${account.blog_score}%` }} />
                    </div>
                  </div>

                  {/* 통계 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <p className="text-slate-400 text-xs">키워드</p>
                      <p className="text-white font-bold">{stats.totalKeywords}</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <p className="text-slate-400 text-xs">노출률</p>
                      <p className={`font-bold ${
                        stats.exposureRate >= 70 ? 'text-emerald-400' :
                        stats.exposureRate >= 40 ? 'text-yellow-400' : 'text-slate-400'
                      }`}>{stats.exposureRate}%</p>
                    </div>
                    <div className="bg-slate-700/50 rounded-lg p-3 text-center">
                      <p className="text-slate-400 text-xs">변동</p>
                      <p className="font-bold">
                        <span className="text-green-400">↑{stats.totalUp}</span>
                        {' / '}
                        <span className="text-red-400">↓{stats.totalDown}</span>
                      </p>
                    </div>
                  </div>

                  {/* URL */}
                  {account.url && (
                    <a 
                      href={account.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-4 block text-purple-400 hover:text-purple-300 text-sm truncate"
                    >
                      🔗 {account.url}
                    </a>
                  )}
                </div>

                {/* 일일 발행 한도 */}
                <div className="px-6 py-3 bg-slate-700/30 border-t border-slate-700 flex items-center justify-between">
                  <span className="text-slate-500 text-sm">일일 발행 한도</span>
                  <span className="text-white font-mono">{account.daily_publish_limit}개</span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 모달 */}
      {showModal && (
        <AccountModal
          account={editingAccount}
          onClose={() => { setShowModal(false); setEditingAccount(null) }}
          onSaved={() => {
            setSuccess(editingAccount ? '계정이 수정되었습니다.' : '계정이 추가되었습니다.')
            setShowModal(false)
            setEditingAccount(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// 계정 모달
function AccountModal({
  account,
  onClose,
  onSaved,
}: {
  account: Account | null
  onClose: () => void
  onSaved: () => void
}) {
  const [formData, setFormData] = useState({
    name: account?.name || '',
    platform: account?.platform || 'naver',
    url: account?.url || '',
    blog_score: account?.blog_score || 50,
    daily_publish_limit: account?.daily_publish_limit || 2,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      name: formData.name,
      platform: formData.platform,
      url: formData.url || null,
      blog_score: formData.blog_score,
      daily_publish_limit: formData.daily_publish_limit,
      updated_at: new Date().toISOString(),
    }

    if (account) {
      const { error } = await supabase.from('accounts').update(payload).eq('id', account.id)
      if (error) { setError('수정 실패: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('accounts').insert(payload)
      if (error) { setError('추가 실패: ' + error.message); setSaving(false); return }
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg mx-4">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-white">
            {account ? '계정 수정' : '계정 추가'}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">계정 이름 *</label>
            <input
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              required
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="예: 메인 블로그"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">플랫폼</label>
              <select
                value={formData.platform}
                onChange={(e) => setFormData({ ...formData, platform: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                <option value="naver">네이버 블로그</option>
                <option value="tistory">티스토리</option>
                <option value="wordpress">WordPress</option>
                <option value="etc">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">일일 발행 한도</label>
              <input
                type="number"
                min="1"
                max="10"
                value={formData.daily_publish_limit}
                onChange={(e) => setFormData({ ...formData, daily_publish_limit: parseInt(e.target.value) || 2 })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">블로그 URL</label>
            <input
              type="url"
              value={formData.url}
              onChange={(e) => setFormData({ ...formData, url: e.target.value })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              placeholder="https://blog.naver.com/..."
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              블로그 지수: {formData.blog_score}점
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={formData.blog_score}
              onChange={(e) => setFormData({ ...formData, blog_score: parseInt(e.target.value) })}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            />
            <div className="flex justify-between text-xs text-slate-500 mt-1">
              <span>0 (저급)</span>
              <span>50 (중급)</span>
              <span>100 (고급)</span>
            </div>
          </div>

          <div className="flex gap-3 pt-4">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600">
              취소
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50">
              {saving ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

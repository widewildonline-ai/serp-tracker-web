'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Account, Keyword, SerpResult } from '@/types/database'
import { useSearchParams } from 'next/navigation'

type KeywordWithAccount = Keyword & { 
  account: Pick<Account, 'id' | 'name'> | null
  serp_results: SerpResult[]
}

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<KeywordWithAccount[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingKeyword, setEditingKeyword] = useState<KeywordWithAccount | null>(null)
  const [selectedKeywords, setSelectedKeywords] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // 작업 상태
  const [actionRunning, setActionRunning] = useState<string | null>(null)
  const [actionProgress, setActionProgress] = useState({ current: 0, total: 0, message: '' })
  
  const searchParams = useSearchParams()
  const supabase = createClient()

  // URL 파라미터로 모달 열기
  useEffect(() => {
    const action = searchParams.get('action')
    if (action === 'new') {
      setShowModal(true)
    }
  }, [searchParams])

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true)
    
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('*')
      .order('name')
    setAccounts(accountsData || [])
    
    const { data: keywordsData, error } = await supabase
      .from('keywords')
      .select(`
        *,
        account:accounts(id, name),
        serp_results(*)
      `)
      .order('created_at', { ascending: false })
    
    if (error) {
      setError('데이터 로드 실패')
    } else {
      const processed = (keywordsData || []).map(kw => ({
        ...kw,
        serp_results: (kw.serp_results || [])
          .sort((a: SerpResult, b: SerpResult) => 
            new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
          )
          .slice(0, 2)
      }))
      setKeywords(processed)
    }
    
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

  // EC2 API 설정 가져오기
  const getEC2Config = async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ec2_api')
      .single()
    return data?.value as { base_url: string; secret: string } | undefined
  }

  // 노출잠재력(opportunity_score) 계산 함수
  const calcOpportunityScore = (volume: number, competition: string, rank: number | null) => {
    // 검색량 점수 (0-40)
    const volumeScore = Math.min(40, Math.log10(volume + 10) * 10)
    
    // 경쟁도 점수 (0-30)
    const compMap: Record<string, number> = { '낮음': 30, '중간': 20, '높음': 10, '알 수 없음': 15 }
    const compScore = compMap[competition] || 15
    
    // 순위 점수 (0-30) - 노출 중이면 보너스
    let rankScore = 15 // 기본
    if (rank !== null) {
      if (rank <= 5) rankScore = 30
      else if (rank <= 10) rankScore = 25
      else if (rank <= 20) rankScore = 20
    }
    
    return Math.round(volumeScore + compScore + rankScore)
  }

  // 난이도(difficulty_score) 계산 함수
  const calcDifficultyScore = (competition: string, rank: number | null) => {
    const compMap: Record<string, number> = { '높음': 80, '중간': 50, '낮음': 20, '알 수 없음': 50 }
    let score = compMap[competition] || 50
    
    // 현재 노출 중이면 난이도 낮춤
    if (rank !== null && rank <= 10) {
      score = Math.max(10, score - 20)
    }
    
    return score
  }

  // 지표 계산 (opportunity_score, difficulty_score)
  const handleCalcScores = async () => {
    const targetKeywords = selectedKeywords.size > 0 
      ? keywords.filter(k => selectedKeywords.has(k.id))
      : keywords

    if (targetKeywords.length === 0) {
      setError('계산할 키워드가 없습니다')
      return
    }

    setActionRunning('calc')
    setActionProgress({ current: 0, total: targetKeywords.length, message: '지표 계산 중...' })

    try {
      for (let i = 0; i < targetKeywords.length; i++) {
        const kw = targetKeywords[i]
        const pcSerp = kw.serp_results?.find(r => r.device === 'PC')
        const moSerp = kw.serp_results?.find(r => r.device === 'MO')
        const bestRank = Math.min(pcSerp?.rank ?? 999, moSerp?.rank ?? 999)
        const rank = bestRank < 999 ? bestRank : null

        const opportunityScore = calcOpportunityScore(kw.monthly_search_total, kw.competition, rank)
        const difficultyScore = calcDifficultyScore(kw.competition, rank)

        await supabase.from('keywords').update({
          opportunity_score: opportunityScore,
          difficulty_score: difficultyScore,
          updated_at: new Date().toISOString()
        }).eq('id', kw.id)

        setActionProgress({ 
          current: i + 1, 
          total: targetKeywords.length, 
          message: `지표 계산 중... (${i + 1}/${targetKeywords.length})`
        })
      }

      setSuccess(`${targetKeywords.length}개 키워드 지표 계산 완료`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '지표 계산 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // 검색량 업데이트
  const handleVolumeUpdate = async () => {
    const targetKeywords = selectedKeywords.size > 0 
      ? keywords.filter(k => selectedKeywords.has(k.id))
      : keywords

    if (targetKeywords.length === 0) {
      setError('업데이트할 키워드가 없습니다')
      return
    }

    setActionRunning('volume')
    setActionProgress({ current: 0, total: targetKeywords.length, message: '검색량 조회 중...' })

    try {
      const ec2Config = await getEC2Config()
      if (!ec2Config?.base_url) {
        throw new Error('EC2 API 설정이 없습니다')
      }

      // 배치로 처리 (10개씩)
      const batchSize = 10
      for (let i = 0; i < targetKeywords.length; i += batchSize) {
        const batch = targetKeywords.slice(i, i + batchSize)
        const keywordNames = batch.map(k => k.sub_keyword || k.keyword)

        const response = await fetch(`${ec2Config.base_url}/api/keyword/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: ec2Config.secret,
            keywords: keywordNames
          })
        })

        if (!response.ok) throw new Error('API 오류')

        const data = await response.json()

        // Supabase 업데이트
        for (const result of data.results) {
          const kw = batch.find(k => (k.sub_keyword || k.keyword) === result.keyword)
          if (kw) {
            await supabase.from('keywords').update({
              monthly_search_pc: result.pc_volume,
              monthly_search_mo: result.mo_volume,
              monthly_search_total: result.total_volume,
              competition: result.competition,
              mobile_ratio: result.total_volume > 0 
                ? Math.round((result.mo_volume / result.total_volume) * 100) 
                : 0,
              updated_at: new Date().toISOString()
            }).eq('id', kw.id)
          }
        }

        setActionProgress({ 
          current: Math.min(i + batchSize, targetKeywords.length), 
          total: targetKeywords.length, 
          message: `검색량 조회 중... (${Math.min(i + batchSize, targetKeywords.length)}/${targetKeywords.length})`
        })
      }

      setSuccess(`${targetKeywords.length}개 키워드 검색량 업데이트 완료`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색량 업데이트 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // SERP 일괄 조회
  const handleSerpBatch = async (mode: 'all' | 'selected') => {
    const targetKeywords = mode === 'selected' && selectedKeywords.size > 0
      ? keywords.filter(k => selectedKeywords.has(k.id))
      : keywords.filter(k => k.url) // URL이 있는 것만

    if (targetKeywords.length === 0) {
      setError('조회할 키워드가 없습니다 (URL이 설정된 키워드만 조회 가능)')
      return
    }

    setActionRunning('serp')
    setActionProgress({ current: 0, total: targetKeywords.length, message: 'SERP 조회 중...' })

    try {
      const ec2Config = await getEC2Config()
      if (!ec2Config?.base_url) {
        throw new Error('EC2 API 설정이 없습니다')
      }

      const today = new Date().toISOString().split('T')[0]

      // 이전 순위 저장 (변동 계산용)
      const prevRanks: Record<string, { pc: number | null; mo: number | null }> = {}
      for (const kw of targetKeywords) {
        const pcResult = kw.serp_results?.find(r => r.device === 'PC')
        const moResult = kw.serp_results?.find(r => r.device === 'MO')
        prevRanks[kw.id] = {
          pc: pcResult?.rank ?? null,
          mo: moResult?.rank ?? null
        }
      }

      // 순차 처리 (1개씩)
      for (let i = 0; i < targetKeywords.length; i++) {
        const kw = targetKeywords[i]
        
        setActionProgress({ 
          current: i + 1, 
          total: targetKeywords.length, 
          message: `SERP 조회: ${kw.keyword} (${i + 1}/${targetKeywords.length})`
        })

        try {
          const response = await fetch(`${ec2Config.base_url}/api/serp/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: ec2Config.secret,
              keyword: kw.sub_keyword || kw.keyword,
              url: kw.url,
              rank_max: 20
            })
          })

          if (!response.ok) continue

          const result = await response.json()
          const prev = prevRanks[kw.id]

          // 변동 계산
          const calcChange = (prevRank: number | null, currRank: number | null) => {
            if (prevRank === null || currRank === null) return 0
            return prevRank - currRank // 양수면 상승, 음수면 하락
          }

          // PC 결과 저장
          await supabase.from('serp_results').upsert({
            keyword_id: kw.id,
            device: 'PC',
            rank: result.pc_rank,
            rank_change: calcChange(prev.pc, result.pc_rank),
            url: kw.url,
            is_exposed: result.pc_rank !== null,
            captured_at: today,
          }, { onConflict: 'keyword_id,device,captured_at' })

          // MO 결과 저장
          await supabase.from('serp_results').upsert({
            keyword_id: kw.id,
            device: 'MO',
            rank: result.mo_rank,
            rank_change: calcChange(prev.mo, result.mo_rank),
            url: kw.url,
            is_exposed: result.mo_rank !== null,
            captured_at: today,
          }, { onConflict: 'keyword_id,device,captured_at' })

        } catch {
          console.error(`SERP 조회 실패: ${kw.keyword}`)
        }

        // 딜레이
        if (i < targetKeywords.length - 1) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      setSuccess(`${targetKeywords.length}개 키워드 SERP 조회 완료`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SERP 조회 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // 키워드 삭제
  const handleDelete = async (keyword: KeywordWithAccount) => {
    if (!confirm(`"${keyword.keyword}" 키워드를 삭제하시겠습니까?`)) return

    const { error } = await supabase.from('keywords').delete().eq('id', keyword.id)

    if (error) {
      setError('삭제 실패: ' + error.message)
    } else {
      setSuccess('키워드가 삭제되었습니다.')
      loadData()
    }
  }

  // 선택 토글
  const toggleSelect = (id: string) => {
    const newSet = new Set(selectedKeywords)
    if (newSet.has(id)) newSet.delete(id)
    else newSet.add(id)
    setSelectedKeywords(newSet)
  }

  const toggleSelectAll = () => {
    if (selectedKeywords.size === keywords.length) {
      setSelectedKeywords(new Set())
    } else {
      setSelectedKeywords(new Set(keywords.map(k => k.id)))
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

  // SERP 결과 가져오기
  const getLatestSerp = (keyword: KeywordWithAccount, device: 'PC' | 'MO') => {
    const result = keyword.serp_results?.find(r => r.device === device)
    return { rank: result?.rank ?? null, change: result?.rank_change ?? 0 }
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">키워드 관리</h1>
          <p className="text-slate-400 mt-1">
            {keywords.length}개 키워드 · {selectedKeywords.size}개 선택됨
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleVolumeUpdate}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            📊 검색량
          </button>
          <button
            onClick={() => handleSerpBatch('all')}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            🔍 SERP
          </button>
          <button
            onClick={handleCalcScores}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            📈 지표계산
          </button>
          <button
            onClick={() => handleSerpBatch('selected')}
            disabled={actionRunning !== null || selectedKeywords.size === 0}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-50 flex items-center gap-2"
          >
            선택({selectedKeywords.size})
          </button>
          <button
            onClick={() => setShowModal(true)}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            ➕ 추가
          </button>
        </div>
      </div>

      {/* 진행 상태 */}
      {actionRunning && (
        <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-4">
          <div className="flex items-center gap-4 mb-2">
            <div className="animate-spin w-5 h-5 border-2 border-purple-500 border-t-transparent rounded-full" />
            <span className="text-purple-400">{actionProgress.message}</span>
          </div>
          <div className="w-full bg-slate-700 rounded-full h-2">
            <div 
              className="bg-purple-500 h-2 rounded-full transition-all"
              style={{ width: `${(actionProgress.current / actionProgress.total) * 100}%` }}
            />
          </div>
        </div>
      )}

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

      {/* 키워드 목록 */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
        {loading ? (
          <div className="p-8 text-center text-slate-400">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            로딩 중...
          </div>
        ) : keywords.length === 0 ? (
          <div className="p-8 text-center text-slate-400">등록된 키워드가 없습니다</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-slate-700/50">
                <tr>
                  <th className="px-3 py-4 text-left">
                    <input
                      type="checkbox"
                      checked={selectedKeywords.size === keywords.length && keywords.length > 0}
                      onChange={toggleSelectAll}
                      className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500"
                    />
                  </th>
                  <th className="px-3 py-4 text-left text-xs font-medium text-slate-400 uppercase">키워드</th>
                  <th className="px-3 py-4 text-left text-xs font-medium text-slate-400 uppercase">계정</th>
                  <th className="px-3 py-4 text-right text-xs font-medium text-slate-400 uppercase">검색량</th>
                  <th className="px-3 py-4 text-center text-xs font-medium text-slate-400 uppercase">경쟁</th>
                  <th className="px-3 py-4 text-center text-xs font-medium text-slate-400 uppercase">MO%</th>
                  <th className="px-3 py-4 text-center text-xs font-medium text-slate-400 uppercase">PC순위</th>
                  <th className="px-3 py-4 text-center text-xs font-medium text-slate-400 uppercase">MO순위</th>
                  <th className="px-3 py-4 text-right text-xs font-medium text-slate-400 uppercase">작업</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700/50">
                {keywords.map((keyword) => {
                  const pcSerp = getLatestSerp(keyword, 'PC')
                  const moSerp = getLatestSerp(keyword, 'MO')
                  
                  return (
                    <tr key={keyword.id} className="hover:bg-slate-700/30">
                      <td className="px-3 py-4">
                        <input
                          type="checkbox"
                          checked={selectedKeywords.has(keyword.id)}
                          onChange={() => toggleSelect(keyword.id)}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-700 text-purple-500"
                        />
                      </td>
                      <td className="px-3 py-4">
                        <div>
                          <p className="text-white font-medium">{keyword.keyword}</p>
                          {keyword.sub_keyword && (
                            <p className="text-slate-500 text-xs">{keyword.sub_keyword}</p>
                          )}
                          {keyword.url && (
                            <a href={keyword.url} target="_blank" rel="noopener noreferrer" 
                               className="text-purple-400 text-xs hover:underline truncate block max-w-[200px]">
                              {keyword.url}
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">
                          {keyword.account?.name || '미지정'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-right">
                        <div className="text-sm">
                          <span className="text-white font-mono">{keyword.monthly_search_total?.toLocaleString() || '-'}</span>
                          <div className="text-slate-500 text-xs">
                            PC:{keyword.monthly_search_pc?.toLocaleString() || 0} / MO:{keyword.monthly_search_mo?.toLocaleString() || 0}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4 text-center">
                        <span className={`px-2 py-1 text-xs rounded ${
                          keyword.competition === '높음' ? 'bg-red-500/20 text-red-400' :
                          keyword.competition === '중간' ? 'bg-yellow-500/20 text-yellow-400' :
                          keyword.competition === '낮음' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {keyword.competition || '-'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-center">
                        <span className="text-slate-300 text-sm">
                          {keyword.mobile_ratio ? `${keyword.mobile_ratio}%` : '-'}
                        </span>
                      </td>
                      <td className="px-3 py-4 text-center">
                        <RankCell rank={pcSerp.rank} change={pcSerp.change} />
                      </td>
                      <td className="px-3 py-4 text-center">
                        <RankCell rank={moSerp.rank} change={moSerp.change} />
                      </td>
                      <td className="px-3 py-4 text-right">
                        <button
                          onClick={() => { setEditingKeyword(keyword); setShowModal(true) }}
                          className="text-slate-400 hover:text-purple-400 px-2 py-1 text-sm"
                        >
                          수정
                        </button>
                        <button
                          onClick={() => handleDelete(keyword)}
                          className="text-slate-400 hover:text-red-400 px-2 py-1 text-sm"
                        >
                          삭제
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 키워드 모달 */}
      {showModal && (
        <KeywordModal
          keyword={editingKeyword}
          accounts={accounts}
          onClose={() => { setShowModal(false); setEditingKeyword(null) }}
          onSaved={() => {
            setSuccess(editingKeyword ? '키워드가 수정되었습니다.' : '키워드가 추가되었습니다.')
            setShowModal(false)
            setEditingKeyword(null)
            loadData()
          }}
        />
      )}
    </div>
  )
}

// 순위 셀
function RankCell({ rank, change }: { rank: number | null; change: number }) {
  if (rank === null) {
    return <span className="text-slate-500 text-sm">-</span>
  }
  
  return (
    <div className="flex items-center justify-center gap-1">
      <span className="text-white font-mono text-sm">{rank}</span>
      {change !== 0 && (
        <span className={`text-xs ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
          {change > 0 ? `↑${change}` : `↓${Math.abs(change)}`}
        </span>
      )}
    </div>
  )
}

// 키워드 모달
function KeywordModal({
  keyword,
  accounts,
  onClose,
  onSaved,
}: {
  keyword: KeywordWithAccount | null
  accounts: Account[]
  onClose: () => void
  onSaved: () => void
}) {
  const [formData, setFormData] = useState({
    account_id: keyword?.account_id || '',
    keyword: keyword?.keyword || '',
    sub_keyword: keyword?.sub_keyword || '',
    url: keyword?.url || '',
    monthly_search_pc: keyword?.monthly_search_pc || 0,
    monthly_search_mo: keyword?.monthly_search_mo || 0,
    competition: keyword?.competition || '알 수 없음',
  })
  const [saving, setSaving] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  
  const supabase = createClient()

  // URL 자동 분석
  const handleAnalyzeUrl = async () => {
    if (!formData.url) return
    
    setAnalyzing(true)
    setError(null)
    
    try {
      const { data: settingsData } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'ec2_api')
        .single()
      
      const ec2Config = settingsData?.value as { base_url: string; secret: string }
      
      const response = await fetch(`${ec2Config.base_url}/api/blog/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          secret: ec2Config.secret,
          url: formData.url
        })
      })
      
      if (!response.ok) throw new Error('분석 실패')
      
      const result = await response.json()
      
      setFormData(prev => ({
        ...prev,
        keyword: result.main_keyword || prev.keyword,
        sub_keyword: result.sub_keyword || prev.sub_keyword,
      }))
    } catch (err) {
      setError('URL 분석 실패')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)

    const payload = {
      account_id: formData.account_id || null,
      keyword: formData.keyword,
      sub_keyword: formData.sub_keyword || null,
      url: formData.url || null,
      monthly_search_pc: formData.monthly_search_pc,
      monthly_search_mo: formData.monthly_search_mo,
      monthly_search_total: formData.monthly_search_pc + formData.monthly_search_mo,
      competition: formData.competition,
      updated_at: new Date().toISOString(),
    }

    if (keyword) {
      const { error } = await supabase.from('keywords').update(payload).eq('id', keyword.id)
      if (error) { setError('수정 실패: ' + error.message); setSaving(false); return }
    } else {
      const { error } = await supabase.from('keywords').insert(payload)
      if (error) { setError('추가 실패: ' + error.message); setSaving(false); return }
    }

    onSaved()
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between sticky top-0 bg-slate-800">
          <h2 className="text-lg font-semibold text-white">
            {keyword ? '키워드 수정' : '키워드 추가'}
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
            <label className="block text-sm font-medium text-slate-300 mb-2">발행 URL</label>
            <div className="flex gap-2">
              <input
                type="url"
                value={formData.url}
                onChange={(e) => setFormData({ ...formData, url: e.target.value })}
                className="flex-1 px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-purple-500"
                placeholder="https://blog.naver.com/..."
              />
              <button
                type="button"
                onClick={handleAnalyzeUrl}
                disabled={!formData.url || analyzing}
                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm"
              >
                {analyzing ? '분석중...' : '분석'}
              </button>
            </div>
            <p className="text-xs text-slate-500 mt-1">URL 입력 후 분석 버튼을 누르면 키워드가 자동 추출됩니다</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">계정</label>
            <select
              value={formData.account_id}
              onChange={(e) => setFormData({ ...formData, account_id: e.target.value })}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            >
              <option value="">미지정</option>
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">메인 키워드 *</label>
              <input
                type="text"
                value={formData.keyword}
                onChange={(e) => setFormData({ ...formData, keyword: e.target.value })}
                required
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                placeholder="예: 캠핑장"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">서브 키워드</label>
              <input
                type="text"
                value={formData.sub_keyword}
                onChange={(e) => setFormData({ ...formData, sub_keyword: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                placeholder="예: 가평 캠핑장"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">PC 검색량</label>
              <input
                type="number"
                min="0"
                value={formData.monthly_search_pc}
                onChange={(e) => setFormData({ ...formData, monthly_search_pc: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">MO 검색량</label>
              <input
                type="number"
                min="0"
                value={formData.monthly_search_mo}
                onChange={(e) => setFormData({ ...formData, monthly_search_mo: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-300 mb-2">경쟁도</label>
              <select
                value={formData.competition}
                onChange={(e) => setFormData({ ...formData, competition: e.target.value })}
                className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
              >
                <option value="알 수 없음">알 수 없음</option>
                <option value="낮음">낮음</option>
                <option value="중간">중간</option>
                <option value="높음">높음</option>
              </select>
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

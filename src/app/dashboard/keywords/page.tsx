'use client'

import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Account, Keyword, Content, SerpResult } from '@/types/database'

// 콘텐츠 + SERP 결과
type ContentWithSerp = Content & {
  account?: Pick<Account, 'id' | 'name'> | null
  serp_results: SerpResult[]
}

// 키워드 + 콘텐츠 목록
type KeywordWithContents = Keyword & {
  contents: ContentWithSerp[]
}

export default function KeywordsPage() {
  const [keywords, setKeywords] = useState<KeywordWithContents[]>([])
  const [accounts, setAccounts] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedKeywords, setExpandedKeywords] = useState<Set<string>>(new Set())
  
  // 모달 상태
  const [showKeywordModal, setShowKeywordModal] = useState(false)
  const [showContentModal, setShowContentModal] = useState(false)
  const [selectedKeywordId, setSelectedKeywordId] = useState<string | null>(null)
  
  // 알림
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // 작업 상태
  const [actionRunning, setActionRunning] = useState<string | null>(null)
  const [actionProgress, setActionProgress] = useState({ current: 0, total: 0, message: '' })
  
  const supabase = createClient()

  // 데이터 로드
  const loadData = useCallback(async () => {
    setLoading(true)
    
    // 계정 로드
    const { data: accountsData } = await supabase
      .from('accounts')
      .select('*')
      .order('name')
    setAccounts(accountsData || [])
    
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
        account:accounts(id, name),
        serp_results(*)
      `)
      .order('created_at', { ascending: false })
    
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
            .slice(0, 2) // PC, MO 최신 결과만
        }))
    }))
    
    setKeywords(keywordsWithContents)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    loadData()
  }, [loadData])

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

  // EC2 API 설정
  const getEC2Config = async () => {
    const { data } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ec2_api')
      .single()
    return data?.value as { base_url: string; secret: string } | undefined
  }

  // 키워드 확장/축소
  const toggleExpand = (keywordId: string) => {
    const newExpanded = new Set(expandedKeywords)
    if (newExpanded.has(keywordId)) {
      newExpanded.delete(keywordId)
    } else {
      newExpanded.add(keywordId)
    }
    setExpandedKeywords(newExpanded)
  }

  // 콘텐츠의 최신 SERP 결과 가져오기
  const getLatestSerp = (content: ContentWithSerp, device: 'PC' | 'MO') => {
    return content.serp_results?.find(r => r.device === device)
  }

  // 순위 표시 헬퍼
  const renderRank = (serp: SerpResult | undefined) => {
    if (!serp || serp.rank === null) {
      return <span className="text-slate-500">-</span>
    }
    const change = serp.rank_change || 0
    return (
      <div className="flex items-center gap-1">
        <span className="text-white font-mono">{serp.rank}</span>
        {change !== 0 && (
          <span className={`text-xs ${change > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {change > 0 ? `↑${change}` : `↓${Math.abs(change)}`}
          </span>
        )}
      </div>
    )
  }

  // 검색량 업데이트
  const handleVolumeUpdate = async () => {
    if (keywords.length === 0) {
      setError('업데이트할 키워드가 없습니다')
      return
    }

    setActionRunning('volume')
    setActionProgress({ current: 0, total: keywords.length, message: '검색량 조회 중...' })

    try {
      const ec2Config = await getEC2Config()
      if (!ec2Config?.base_url) {
        throw new Error('EC2 API 설정이 없습니다')
      }

      // 배치 처리 (10개씩)
      const batchSize = 10
      for (let i = 0; i < keywords.length; i += batchSize) {
        const batch = keywords.slice(i, i + batchSize)
        const kwList = batch.map(k => k.sub_keyword || k.keyword)

        const response = await fetch(`${ec2Config.base_url}/api/keyword/volume`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: ec2Config.secret, keywords: kwList })
        })

        if (!response.ok) throw new Error('API 오류')

        const data = await response.json()

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
          current: Math.min(i + batchSize, keywords.length), 
          total: keywords.length, 
          message: `검색량 조회 중... (${Math.min(i + batchSize, keywords.length)}/${keywords.length})`
        })
      }

      setSuccess(`${keywords.length}개 키워드 검색량 업데이트 완료`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '검색량 업데이트 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // SERP 조회 (활성 콘텐츠만)
  const handleSerpBatch = async () => {
    // 활성 콘텐츠만 필터링
    const activeContents = keywords.flatMap(kw => 
      kw.contents.filter(c => c.is_active && c.url)
    )

    if (activeContents.length === 0) {
      setError('조회할 활성 콘텐츠가 없습니다')
      return
    }

    setActionRunning('serp')
    setActionProgress({ current: 0, total: activeContents.length, message: 'SERP 조회 중...' })

    try {
      const ec2Config = await getEC2Config()
      if (!ec2Config?.base_url) {
        throw new Error('EC2 API 설정이 없습니다')
      }

      const today = new Date().toISOString().split('T')[0]

      for (let i = 0; i < activeContents.length; i++) {
        const content = activeContents[i]
        const keyword = keywords.find(k => k.id === content.keyword_id)
        
        setActionProgress({ 
          current: i + 1, 
          total: activeContents.length, 
          message: `SERP 조회: ${keyword?.keyword || ''} (${i + 1}/${activeContents.length})`
        })

        // 이전 순위 저장
        const prevPc = getLatestSerp(content, 'PC')?.rank ?? null
        const prevMo = getLatestSerp(content, 'MO')?.rank ?? null

        try {
          const response = await fetch(`${ec2Config.base_url}/api/serp/check`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: ec2Config.secret,
              keyword: keyword?.sub_keyword || keyword?.keyword,
              url: content.url,
              rank_max: 20
            })
          })

          if (!response.ok) continue

          const result = await response.json()

          // 변동 계산
          const calcChange = (prev: number | null, curr: number | null) => {
            if (prev === null || curr === null) return 0
            return prev - curr
          }

          // PC 결과 저장
          await supabase.from('serp_results').upsert({
            content_id: content.id,
            device: 'PC',
            rank: result.pc_rank,
            rank_change: calcChange(prevPc, result.pc_rank),
            is_exposed: result.pc_rank !== null,
            captured_at: today,
          }, { onConflict: 'content_id,device,captured_at' })

          // MO 결과 저장
          await supabase.from('serp_results').upsert({
            content_id: content.id,
            device: 'MO',
            rank: result.mo_rank,
            rank_change: calcChange(prevMo, result.mo_rank),
            is_exposed: result.mo_rank !== null,
            captured_at: today,
          }, { onConflict: 'content_id,device,captured_at' })

          // 미노출이면 is_active = false 처리
          if (result.pc_rank === null && result.mo_rank === null) {
            await supabase.from('contents').update({
              is_active: false,
              updated_at: new Date().toISOString()
            }).eq('id', content.id)
          }

        } catch {
          console.error(`SERP 조회 실패: ${content.url}`)
        }

        // 딜레이
        if (i < activeContents.length - 1) {
          await new Promise(r => setTimeout(r, 2000))
        }
      }

      setSuccess(`${activeContents.length}개 콘텐츠 SERP 조회 완료`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SERP 조회 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // 발행기록에서 동기화
  const handleSyncFromPublishRecords = async () => {
    if (!confirm('발행 기록(publish_records)에서 키워드와 콘텐츠를 가져옵니다.\n\n계속하시겠습니까?')) return

    setActionRunning('sync')
    setActionProgress({ current: 0, total: 0, message: '발행 기록 조회 중...' })

    try {
      // 발행 기록 조회
      const { data: publishRecords, error: prError } = await supabase
        .from('publish_records')
        .select('*')

      if (prError) throw prError
      if (!publishRecords || publishRecords.length === 0) {
        setError('발행 기록이 없습니다')
        return
      }

      setActionProgress({ current: 0, total: publishRecords.length, message: `${publishRecords.length}개 발행 기록 동기화 중...` })

      // 계정 이름 -> ID 매핑
      const accountMap = new Map(accounts.map(a => [a.name.toLowerCase(), a.id]))

      let keywordCount = 0
      let contentCount = 0

      for (let i = 0; i < publishRecords.length; i++) {
        const pr = publishRecords[i]
        if (!pr.main_keyword) continue

        // 1. 키워드 추가/조회
        let keywordId: string

        const { data: existingKw } = await supabase
          .from('keywords')
          .select('id')
          .eq('keyword', pr.main_keyword)
          .single()

        if (existingKw) {
          keywordId = existingKw.id
        } else {
          // 새 키워드 추가
          const { data: newKw, error: kwError } = await supabase
            .from('keywords')
            .insert({
              keyword: pr.main_keyword,
              sub_keyword: pr.sub_keyword,
              monthly_search_pc: pr.search_pc || 0,
              monthly_search_mo: pr.search_mo || 0,
              monthly_search_total: pr.search_total || 0,
              competition: pr.competition || '알 수 없음',
              mobile_ratio: pr.mobile_ratio || 0,
              opportunity_score: pr.opportunity_score || 0,
            })
            .select('id')
            .single()

          if (kwError || !newKw) continue
          keywordId = newKw.id
          keywordCount++
        }

        // 2. 콘텐츠 추가 (URL이 있는 경우만)
        if (pr.url) {
          const accountId = pr.account_name ? accountMap.get(pr.account_name.toLowerCase()) : null

          // 중복 체크
          const { data: existingContent } = await supabase
            .from('contents')
            .select('id')
            .eq('keyword_id', keywordId)
            .eq('url', pr.url)
            .single()

          if (!existingContent) {
            const isExposed = pr.rank_pc !== null || pr.rank_mo !== null

            await supabase.from('contents').insert({
              keyword_id: keywordId,
              account_id: accountId || null,
              url: pr.url,
              title: pr.title,
              published_date: pr.published_date,
              is_active: isExposed, // 노출 중이면 활성
              camfit_link: pr.camfit_link || false,
              source_file: pr.source_file,
            })
            contentCount++
          }
        }

        setActionProgress({ 
          current: i + 1, 
          total: publishRecords.length, 
          message: `동기화 중... (${i + 1}/${publishRecords.length})`
        })
      }

      setSuccess(`동기화 완료: 키워드 ${keywordCount}개, 콘텐츠 ${contentCount}개 추가`)
      loadData()
    } catch (err) {
      setError(err instanceof Error ? err.message : '동기화 실패')
    } finally {
      setActionRunning(null)
    }
  }

  // 키워드 삭제
  const handleDeleteKeyword = async (keyword: KeywordWithContents) => {
    if (keyword.contents.length > 0) {
      if (!confirm(`"${keyword.keyword}" 키워드에 ${keyword.contents.length}개의 콘텐츠가 있습니다.\n키워드와 모든 콘텐츠가 삭제됩니다.\n\n계속하시겠습니까?`)) return
    } else {
      if (!confirm(`"${keyword.keyword}" 키워드를 삭제하시겠습니까?`)) return
    }

    const { error } = await supabase.from('keywords').delete().eq('id', keyword.id)
    if (error) {
      setError('삭제 실패')
    } else {
      setSuccess('키워드가 삭제되었습니다')
      loadData()
    }
  }

  // 콘텐츠 삭제
  const handleDeleteContent = async (content: ContentWithSerp) => {
    if (!confirm('이 콘텐츠를 삭제하시겠습니까?')) return

    const { error } = await supabase.from('contents').delete().eq('id', content.id)
    if (error) {
      setError('삭제 실패')
    } else {
      setSuccess('콘텐츠가 삭제되었습니다')
      loadData()
    }
  }

  // 콘텐츠 활성화/비활성화 토글
  const toggleContentActive = async (content: ContentWithSerp) => {
    const newActive = !content.is_active
    await supabase.from('contents').update({
      is_active: newActive,
      updated_at: new Date().toISOString()
    }).eq('id', content.id)
    loadData()
  }

  // 통계
  const stats = {
    totalKeywords: keywords.length,
    totalContents: keywords.reduce((sum, k) => sum + k.contents.length, 0),
    activeContents: keywords.reduce((sum, k) => sum + k.contents.filter(c => c.is_active).length, 0),
    exposedContents: keywords.reduce((sum, k) => 
      sum + k.contents.filter(c => {
        const pc = getLatestSerp(c, 'PC')
        const mo = getLatestSerp(c, 'MO')
        return (pc?.rank !== null && pc?.rank !== undefined) || (mo?.rank !== null && mo?.rank !== undefined)
      }).length, 0
    ),
  }

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">키워드 관리</h1>
          <p className="text-slate-400 mt-1">
            {stats.totalKeywords}개 키워드 · {stats.totalContents}개 콘텐츠 · {stats.activeContents}개 추적 중
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={handleSyncFromPublishRecords}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            📥 발행기록 동기화
          </button>
          <button
            onClick={handleVolumeUpdate}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            📊 검색량
          </button>
          <button
            onClick={handleSerpBatch}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            🔍 SERP
          </button>
          <button
            onClick={() => setShowKeywordModal(true)}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600 transition disabled:opacity-50 flex items-center gap-2"
          >
            ➕ 키워드
          </button>
          <button
            onClick={() => { setSelectedKeywordId(null); setShowContentModal(true) }}
            disabled={actionRunning !== null}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition disabled:opacity-50 flex items-center gap-2"
          >
            📝 콘텐츠
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
              style={{ width: `${actionProgress.total > 0 ? (actionProgress.current / actionProgress.total) * 100 : 0}%` }}
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
      <div className="space-y-3">
        {loading ? (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-8 text-center text-slate-400">
            <div className="animate-spin w-8 h-8 border-2 border-purple-500 border-t-transparent rounded-full mx-auto mb-4" />
            로딩 중...
          </div>
        ) : keywords.length === 0 ? (
          <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-8 text-center text-slate-400">
            <p className="text-4xl mb-4">📭</p>
            <p>등록된 키워드가 없습니다</p>
            <p className="text-sm mt-2">"발행기록 동기화" 또는 "키워드 추가"로 시작하세요</p>
          </div>
        ) : (
          keywords.map(keyword => {
            const isExpanded = expandedKeywords.has(keyword.id)
            const activeCount = keyword.contents.filter(c => c.is_active).length
            const exposedCount = keyword.contents.filter(c => {
              const pc = getLatestSerp(c, 'PC')
              const mo = getLatestSerp(c, 'MO')
              return pc?.is_exposed || mo?.is_exposed
            }).length

            return (
              <div key={keyword.id} className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
                {/* 키워드 헤더 */}
                <div 
                  className="flex items-center justify-between p-4 cursor-pointer hover:bg-slate-700/30 transition"
                  onClick={() => toggleExpand(keyword.id)}
                >
                  <div className="flex items-center gap-4">
                    <span className="text-slate-400 text-lg">
                      {isExpanded ? '▼' : '▶'}
                    </span>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-white font-semibold text-lg">{keyword.keyword}</span>
                        {keyword.sub_keyword && (
                          <span className="text-slate-500 text-sm">({keyword.sub_keyword})</span>
                        )}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-sm">
                        <span className="text-slate-400">
                          검색량: <span className="text-white font-mono">{keyword.monthly_search_total.toLocaleString()}</span>
                        </span>
                        <span className={`px-2 py-0.5 text-xs rounded ${
                          keyword.competition === '높음' ? 'bg-red-500/20 text-red-400' :
                          keyword.competition === '중간' ? 'bg-yellow-500/20 text-yellow-400' :
                          keyword.competition === '낮음' ? 'bg-emerald-500/20 text-emerald-400' :
                          'bg-slate-500/20 text-slate-400'
                        }`}>
                          {keyword.competition}
                        </span>
                        <span className="text-slate-500">
                          콘텐츠 {keyword.contents.length}개
                        </span>
                        {activeCount > 0 && (
                          <span className="text-emerald-400">
                            추적 {activeCount}개
                          </span>
                        )}
                        {exposedCount > 0 && (
                          <span className="text-purple-400">
                            노출 {exposedCount}개
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <button
                      onClick={() => { setSelectedKeywordId(keyword.id); setShowContentModal(true) }}
                      className="px-3 py-1 text-sm bg-emerald-600/20 text-emerald-400 rounded hover:bg-emerald-600/30 transition"
                    >
                      + 콘텐츠
                    </button>
                    <button
                      onClick={() => handleDeleteKeyword(keyword)}
                      className="px-3 py-1 text-sm bg-red-600/20 text-red-400 rounded hover:bg-red-600/30 transition"
                    >
                      삭제
                    </button>
                  </div>
                </div>

                {/* 콘텐츠 목록 (펼쳤을 때) */}
                {isExpanded && (
                  <div className="border-t border-slate-700">
                    {keyword.contents.length === 0 ? (
                      <div className="p-4 text-center text-slate-500 text-sm">
                        등록된 콘텐츠가 없습니다
                      </div>
                    ) : (
                      <div className="divide-y divide-slate-700/50">
                        {keyword.contents.map(content => {
                          const pcSerp = getLatestSerp(content, 'PC')
                          const moSerp = getLatestSerp(content, 'MO')
                          
                          return (
                            <div 
                              key={content.id} 
                              className={`p-4 pl-12 flex items-center justify-between ${
                                !content.is_active ? 'opacity-50' : ''
                              }`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className={`w-2 h-2 rounded-full ${
                                    content.is_active ? 'bg-emerald-500' : 'bg-slate-500'
                                  }`} />
                                  {content.title ? (
                                    <a 
                                      href={content.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-white hover:text-purple-400 truncate"
                                    >
                                      📄 {content.title}
                                    </a>
                                  ) : (
                                    <a 
                                      href={content.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="text-purple-400 hover:underline text-sm truncate"
                                    >
                                      {content.url}
                                    </a>
                                  )}
                                </div>
                                <div className="flex items-center gap-4 mt-1 text-sm text-slate-500">
                                  {content.account && (
                                    <span className="bg-slate-700 px-2 py-0.5 rounded text-xs">
                                      {content.account.name}
                                    </span>
                                  )}
                                  {content.published_date && (
                                    <span>{content.published_date}</span>
                                  )}
                                  {!content.is_active && (
                                    <span className="text-red-400 text-xs">추적 중지</span>
                                  )}
                                </div>
                              </div>
                              <div className="flex items-center gap-6">
                                <div className="text-center">
                                  <p className="text-slate-500 text-xs mb-1">PC</p>
                                  {renderRank(pcSerp)}
                                </div>
                                <div className="text-center">
                                  <p className="text-slate-500 text-xs mb-1">MO</p>
                                  {renderRank(moSerp)}
                                </div>
                                <div className="flex gap-2">
                                  <button
                                    onClick={() => toggleContentActive(content)}
                                    className={`px-2 py-1 text-xs rounded ${
                                      content.is_active 
                                        ? 'bg-slate-600/50 text-slate-400 hover:bg-slate-600'
                                        : 'bg-emerald-600/20 text-emerald-400 hover:bg-emerald-600/30'
                                    }`}
                                  >
                                    {content.is_active ? '중지' : '활성화'}
                                  </button>
                                  <button
                                    onClick={() => handleDeleteContent(content)}
                                    className="px-2 py-1 text-xs bg-red-600/20 text-red-400 rounded hover:bg-red-600/30"
                                  >
                                    삭제
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* 키워드 추가 모달 */}
      {showKeywordModal && (
        <KeywordModal
          supabase={supabase}
          existingKeywords={keywords.map(k => k.keyword.toLowerCase())}
          onClose={() => setShowKeywordModal(false)}
          onSuccess={(msg) => { setSuccess(msg); loadData() }}
          onError={setError}
        />
      )}

      {/* 콘텐츠 추가 모달 */}
      {showContentModal && (
        <ContentModal
          supabase={supabase}
          keywords={keywords}
          accounts={accounts}
          preselectedKeywordId={selectedKeywordId}
          onClose={() => { setShowContentModal(false); setSelectedKeywordId(null) }}
          onSuccess={(msg) => { setSuccess(msg); loadData() }}
          onError={setError}
        />
      )}
    </div>
  )
}

// 키워드 추가 모달
function KeywordModal({
  supabase,
  existingKeywords,
  onClose,
  onSuccess,
  onError,
}: {
  supabase: ReturnType<typeof createClient>
  existingKeywords: string[]
  onClose: () => void
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [subKeyword, setSubKeyword] = useState('')
  const [saving, setSaving] = useState(false)

  const handleSave = async () => {
    if (!keyword.trim()) {
      onError('키워드를 입력하세요')
      return
    }

    if (existingKeywords.includes(keyword.trim().toLowerCase())) {
      onError('이미 존재하는 키워드입니다')
      return
    }

    setSaving(true)
    const { error } = await supabase.from('keywords').insert({
      keyword: keyword.trim(),
      sub_keyword: subKeyword.trim() || null,
    })

    if (error) {
      onError('키워드 추가 실패')
    } else {
      onSuccess('키워드가 추가되었습니다')
      onClose()
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-4">키워드 추가</h2>
        
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-slate-400 mb-1">메인 키워드 *</label>
            <input
              type="text"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              placeholder="예: 캠핑장"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
          <div>
            <label className="block text-sm text-slate-400 mb-1">서브 키워드</label>
            <input
              type="text"
              value={subKeyword}
              onChange={e => setSubKeyword(e.target.value)}
              placeholder="예: 가평 캠핑장"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

// 콘텐츠 추가 모달
function ContentModal({
  supabase,
  keywords,
  accounts,
  preselectedKeywordId,
  onClose,
  onSuccess,
  onError,
}: {
  supabase: ReturnType<typeof createClient>
  keywords: KeywordWithContents[]
  accounts: Account[]
  preselectedKeywordId: string | null
  onClose: () => void
  onSuccess: (msg: string) => void
  onError: (msg: string) => void
}) {
  const [keywordInput, setKeywordInput] = useState('')
  const [selectedKeywordId, setSelectedKeywordId] = useState(preselectedKeywordId || '')
  const [url, setUrl] = useState('')
  const [title, setTitle] = useState('')
  const [accountId, setAccountId] = useState('')
  const [saving, setSaving] = useState(false)

  // 키워드 검색 결과
  const filteredKeywords = keywordInput
    ? keywords.filter(k => 
        k.keyword.toLowerCase().includes(keywordInput.toLowerCase()) ||
        k.sub_keyword?.toLowerCase().includes(keywordInput.toLowerCase())
      )
    : keywords

  const handleSave = async () => {
    if (!url.trim()) {
      onError('URL을 입력하세요')
      return
    }

    let finalKeywordId = selectedKeywordId

    // 키워드가 선택되지 않았고 입력값이 있으면 새 키워드 생성
    if (!finalKeywordId && keywordInput.trim()) {
      const existing = keywords.find(k => k.keyword.toLowerCase() === keywordInput.trim().toLowerCase())
      
      if (existing) {
        finalKeywordId = existing.id
      } else {
        // 새 키워드 생성
        const { data: newKw, error: kwError } = await supabase
          .from('keywords')
          .insert({ keyword: keywordInput.trim() })
          .select('id')
          .single()

        if (kwError || !newKw) {
          onError('키워드 생성 실패')
          return
        }
        finalKeywordId = newKw.id
      }
    }

    if (!finalKeywordId) {
      onError('키워드를 선택하거나 입력하세요')
      return
    }

    setSaving(true)
    
    const { error } = await supabase.from('contents').insert({
      keyword_id: finalKeywordId,
      account_id: accountId || null,
      url: url.trim(),
      title: title.trim() || null,
      is_active: true,
    })

    if (error) {
      if (error.code === '23505') {
        onError('이미 등록된 콘텐츠입니다 (같은 키워드에 같은 URL)')
      } else {
        onError('콘텐츠 추가 실패')
      }
    } else {
      onSuccess('콘텐츠가 추가되었습니다')
      onClose()
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md p-6">
        <h2 className="text-xl font-bold text-white mb-4">콘텐츠 추가</h2>
        
        <div className="space-y-4">
          {/* 키워드 선택/입력 */}
          <div>
            <label className="block text-sm text-slate-400 mb-1">키워드 *</label>
            {preselectedKeywordId ? (
              <div className="px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white">
                {keywords.find(k => k.id === preselectedKeywordId)?.keyword}
              </div>
            ) : (
              <>
                <input
                  type="text"
                  value={keywordInput}
                  onChange={e => { setKeywordInput(e.target.value); setSelectedKeywordId('') }}
                  placeholder="키워드 검색 또는 새 키워드 입력"
                  className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
                />
                {keywordInput && filteredKeywords.length > 0 && (
                  <div className="mt-2 max-h-32 overflow-y-auto bg-slate-700 rounded-lg border border-slate-600">
                    {filteredKeywords.slice(0, 5).map(k => (
                      <div
                        key={k.id}
                        onClick={() => { setSelectedKeywordId(k.id); setKeywordInput(k.keyword) }}
                        className={`px-4 py-2 cursor-pointer hover:bg-slate-600 ${
                          selectedKeywordId === k.id ? 'bg-purple-600/30' : ''
                        }`}
                      >
                        <span className="text-white">{k.keyword}</span>
                        {k.sub_keyword && <span className="text-slate-500 text-sm ml-2">({k.sub_keyword})</span>}
                      </div>
                    ))}
                  </div>
                )}
                {keywordInput && !selectedKeywordId && filteredKeywords.length === 0 && (
                  <p className="text-sm text-emerald-400 mt-1">새 키워드로 추가됩니다</p>
                )}
              </>
            )}
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">URL *</label>
            <input
              type="text"
              value={url}
              onChange={e => setUrl(e.target.value)}
              placeholder="https://blog.naver.com/..."
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">제목</label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="콘텐츠 제목 (선택)"
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            />
          </div>

          <div>
            <label className="block text-sm text-slate-400 mb-1">계정</label>
            <select
              value={accountId}
              onChange={e => setAccountId(e.target.value)}
              className="w-full px-4 py-2 bg-slate-700 border border-slate-600 rounded-lg text-white"
            >
              <option value="">선택 안 함</option>
              {accounts.map(a => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-700 text-white rounded-lg hover:bg-slate-600"
          >
            취소
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
          >
            {saving ? '저장 중...' : '추가'}
          </button>
        </div>
      </div>
    </div>
  )
}

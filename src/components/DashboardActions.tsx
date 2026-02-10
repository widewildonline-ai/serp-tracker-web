'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

interface ServerStatus {
  ok: boolean
  rank_locked: boolean
  volume_locked: boolean
  analysis_locked: boolean
}

export default function DashboardActions() {
  const [serverStatus, setServerStatus] = useState<ServerStatus | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null)
  const [ec2Config, setEc2Config] = useState<{ base_url: string; secret: string } | null>(null)

  const supabase = createClient()

  // EC2 설정 로드
  useEffect(() => {
    const loadConfig = async () => {
      const { data } = await supabase
        .from('settings')
        .select('value')
        .eq('key', 'ec2_api')
        .single()
      
      if (data?.value) {
        setEc2Config(data.value as { base_url: string; secret: string })
      }
    }
    loadConfig()
  }, [supabase])

  // 서버 상태 확인
  const checkServerStatus = async () => {
    if (!ec2Config) {
      setMessage({ type: 'error', text: 'EC2 API 설정이 없습니다' })
      return
    }

    setLoading('status')
    try {
      const response = await fetch(`${ec2Config.base_url}/health`, {
        method: 'GET',
      })
      
      if (!response.ok) throw new Error('서버 응답 오류')
      
      const data = await response.json()
      setServerStatus(data)
      setMessage({ type: 'success', text: data.ok ? '서버 정상 연결' : '서버 상태 확인 필요' })
    } catch (err) {
      setMessage({ type: 'error', text: '서버 연결 실패' })
      setServerStatus(null)
    } finally {
      setLoading(null)
    }
  }

  // 주간 분석 실행 (블로그 지수 계산)
  const runWeeklyAnalysis = async () => {
    if (!ec2Config) {
      setMessage({ type: 'error', text: 'EC2 API 설정이 없습니다' })
      return
    }

    if (!confirm('주간 분석을 실행합니다.\n\n• 블로그 지수 계산\n• 노출잠재력 평가\n• 발행 추천 생성\n\n계속하시겠습니까?')) return

    setLoading('analysis')
    try {
      const response = await fetch(`${ec2Config.base_url}/run-analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: ec2Config.secret })
      })
      
      if (!response.ok) throw new Error('서버 응답 오류')
      
      const data = await response.json()
      if (data.ok) {
        setMessage({ type: 'success', text: `주간 분석 시작됨 (PID: ${data.pid})` })
        // 상태 새로고침
        setTimeout(checkServerStatus, 2000)
      } else {
        throw new Error(data.detail || '알 수 없는 오류')
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '분석 실행 실패' })
    } finally {
      setLoading(null)
    }
  }

  // 주간 순위 추적
  const runWeeklyRank = async () => {
    if (!ec2Config) {
      setMessage({ type: 'error', text: 'EC2 API 설정이 없습니다' })
      return
    }

    if (!confirm('주간 전체 최신화를 실행합니다.\n모든 키워드의 순위를 새로 수집합니다.\n\n계속하시겠습니까?')) return

    setLoading('rank')
    try {
      const response = await fetch(`${ec2Config.base_url}/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: ec2Config.secret, mode: 'weekly' })
      })
      
      if (!response.ok) throw new Error('서버 응답 오류')
      
      const data = await response.json()
      if (data.ok) {
        setMessage({ type: 'success', text: `순위 추적 시작됨 (PID: ${data.pid})` })
        setTimeout(checkServerStatus, 2000)
      } else {
        throw new Error(data.detail || '알 수 없는 오류')
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '순위 추적 실패' })
    } finally {
      setLoading(null)
    }
  }

  // 검색량 최신화
  const runVolumeUpdate = async () => {
    if (!ec2Config) {
      setMessage({ type: 'error', text: 'EC2 API 설정이 없습니다' })
      return
    }

    if (!confirm('검색량 최신화를 실행합니다.\n모든 키워드의 월간 검색량을 업데이트합니다.\n\n계속하시겠습니까?')) return

    setLoading('volume')
    try {
      const response = await fetch(`${ec2Config.base_url}/run-volume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: ec2Config.secret })
      })
      
      if (!response.ok) throw new Error('서버 응답 오류')
      
      const data = await response.json()
      if (data.ok) {
        setMessage({ type: 'success', text: `검색량 최신화 시작됨 (PID: ${data.pid})` })
        setTimeout(checkServerStatus, 2000)
      } else {
        throw new Error(data.detail || '알 수 없는 오류')
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : '검색량 업데이트 실패' })
    } finally {
      setLoading(null)
    }
  }

  // 메시지 자동 숨김
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(null), 5000)
      return () => clearTimeout(timer)
    }
  }, [message])

  return (
    <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-white">🛠️ 작업 실행</h2>
        <button
          onClick={checkServerStatus}
          disabled={loading !== null}
          className="text-sm text-purple-400 hover:text-purple-300 disabled:opacity-50"
        >
          {loading === 'status' ? '확인 중...' : '📡 서버 상태'}
        </button>
      </div>

      {/* 서버 상태 표시 */}
      {serverStatus && (
        <div className="mb-4 p-4 bg-slate-700/50 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <div className={`w-2 h-2 rounded-full ${serverStatus.ok ? 'bg-emerald-500' : 'bg-red-500'}`} />
            <p className="text-slate-400 text-sm">서버 {serverStatus.ok ? '정상' : '오류'}</p>
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${serverStatus.rank_locked ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-slate-300">순위 추적</span>
              {serverStatus.rank_locked ? 
                <span className="text-xs text-yellow-400">실행 중</span> : 
                <span className="text-xs text-emerald-400">대기</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${serverStatus.volume_locked ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-slate-300">검색량</span>
              {serverStatus.volume_locked ? 
                <span className="text-xs text-yellow-400">실행 중</span> : 
                <span className="text-xs text-emerald-400">대기</span>}
            </div>
            <div className="flex items-center gap-2">
              <div className={`w-2 h-2 rounded-full ${serverStatus.analysis_locked ? 'bg-yellow-500 animate-pulse' : 'bg-emerald-500'}`} />
              <span className="text-slate-300">분석</span>
              {serverStatus.analysis_locked ? 
                <span className="text-xs text-yellow-400">실행 중</span> : 
                <span className="text-xs text-emerald-400">대기</span>}
            </div>
          </div>
        </div>
      )}

      {/* 메시지 */}
      {message && (
        <div className={`mb-4 p-3 rounded-lg text-sm ${
          message.type === 'success' 
            ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-400'
            : 'bg-red-500/10 border border-red-500/30 text-red-400'
        }`}>
          {message.text}
        </div>
      )}

      {/* 액션 버튼들 */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <button
          onClick={runWeeklyRank}
          disabled={loading !== null || serverStatus?.rank_locked}
          className="flex flex-col items-center gap-2 p-4 bg-blue-600/20 border border-blue-500/30 rounded-lg hover:bg-blue-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-2xl">🔄</span>
          <span className="text-blue-300 text-sm font-medium">주간 전체 최신화</span>
          <span className="text-slate-500 text-xs">순위 전체 수집</span>
          {loading === 'rank' && <span className="text-xs text-yellow-400">실행 중...</span>}
        </button>

        <button
          onClick={runVolumeUpdate}
          disabled={loading !== null || serverStatus?.volume_locked}
          className="flex flex-col items-center gap-2 p-4 bg-green-600/20 border border-green-500/30 rounded-lg hover:bg-green-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-2xl">📈</span>
          <span className="text-green-300 text-sm font-medium">검색량 최신화</span>
          <span className="text-slate-500 text-xs">월간 검색량 업데이트</span>
          {loading === 'volume' && <span className="text-xs text-yellow-400">실행 중...</span>}
        </button>

        <button
          onClick={runWeeklyAnalysis}
          disabled={loading !== null || serverStatus?.analysis_locked}
          className="flex flex-col items-center gap-2 p-4 bg-purple-600/20 border border-purple-500/30 rounded-lg hover:bg-purple-600/30 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-2xl">📊</span>
          <span className="text-purple-300 text-sm font-medium">발행 추천 분석</span>
          <span className="text-slate-500 text-xs">지수 계산 & 추천 생성</span>
          {loading === 'analysis' && <span className="text-xs text-yellow-400">실행 중...</span>}
        </button>

        <a
          href="/dashboard/recommendations"
          className="flex flex-col items-center gap-2 p-4 bg-amber-600/20 border border-amber-500/30 rounded-lg hover:bg-amber-600/30 transition"
        >
          <span className="text-2xl">💡</span>
          <span className="text-amber-300 text-sm font-medium">발행 추천 보기</span>
          <span className="text-slate-500 text-xs">추천 페이지로 이동</span>
        </a>

        <button
          onClick={checkServerStatus}
          disabled={loading !== null}
          className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 border border-slate-600 rounded-lg hover:bg-slate-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <span className="text-2xl">📡</span>
          <span className="text-slate-300 text-sm font-medium">서버 상태</span>
          <span className="text-slate-500 text-xs">연결 상태 확인</span>
          {loading === 'status' && <span className="text-xs text-yellow-400">확인 중...</span>}
        </button>
      </div>

      {/* 안내 */}
      <p className="mt-4 text-slate-500 text-xs text-center">
        작업 실행 시 EC2 서버에서 백그라운드로 처리됩니다. 완료 시 Slack 알림이 발송됩니다.
      </p>
    </div>
  )
}

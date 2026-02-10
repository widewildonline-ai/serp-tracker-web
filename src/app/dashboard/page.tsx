import { createClient } from '@/lib/supabase/server'
import { Account, Keyword, Content, SerpResult } from '@/types/database'
import Link from 'next/link'
import DashboardActions from '@/components/DashboardActions'

// 콘텐츠 + SERP 타입
type ContentWithSerp = Content & {
  keyword?: Pick<Keyword, 'id' | 'keyword' | 'sub_keyword' | 'monthly_search_total' | 'competition'>
  account?: Pick<Account, 'id' | 'name'> | null
  serp_results: SerpResult[]
}

// 키워드 + 콘텐츠 통계
type KeywordWithStats = Keyword & {
  contents: ContentWithSerp[]
  pcRank: number | null
  moRank: number | null
  pcChange: number
  moChange: number
  accountName: string | null
}

export default async function DashboardPage() {
  const supabase = await createClient()
  
  // 계정 데이터
  const { data: accounts, error: accountsError } = await supabase
    .from('accounts')
    .select('*')
    .order('blog_score', { ascending: false })
  
  // 키워드 데이터
  const { data: keywords, error: keywordsError } = await supabase
    .from('keywords')
    .select('*')
    .order('monthly_search_total', { ascending: false })
  
  // 콘텐츠 + SERP 데이터 (V2 구조)
  const { data: contents, error: contentsError } = await supabase
    .from('contents')
    .select(`
      *,
      keyword:keywords(id, keyword, sub_keyword, monthly_search_total, competition),
      account:accounts(id, name),
      serp_results(*)
    `)
    .eq('is_active', true)
  
  const hasError = accountsError || keywordsError || contentsError
  
  // 통계 계산
  const totalAccounts = accounts?.length || 0
  const totalKeywords = keywords?.length || 0
  const avgBlogScore = totalAccounts > 0 
    ? Math.round((accounts as Account[]).reduce((sum, a) => sum + (a.blog_score || 0), 0) / totalAccounts)
    : 0

  // 키워드별 콘텐츠 그룹화 및 SERP 통계 계산
  const keywordsWithSerp: KeywordWithStats[] = (keywords || []).map(kw => {
    const kwContents = (contents || [])
      .filter(c => c.keyword_id === kw.id)
      .map(c => ({
        ...c,
        serp_results: (c.serp_results || [])
          .sort((a: SerpResult, b: SerpResult) => 
            new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime()
          )
      })) as ContentWithSerp[]
    
    // 해당 키워드의 모든 콘텐츠 중 최고 순위 찾기
    let bestPcRank: number | null = null
    let bestMoRank: number | null = null
    let bestPcChange = 0
    let bestMoChange = 0
    let accountName: string | null = null
    
    kwContents.forEach(content => {
      const pcSerp = content.serp_results?.find(r => r.device === 'PC')
      const moSerp = content.serp_results?.find(r => r.device === 'MO')
      
      if (pcSerp?.rank !== null && pcSerp?.rank !== undefined) {
        if (bestPcRank === null || pcSerp.rank < bestPcRank) {
          bestPcRank = pcSerp.rank
          bestPcChange = pcSerp.rank_change || 0
          accountName = content.account?.name || null
        }
      }
      if (moSerp?.rank !== null && moSerp?.rank !== undefined) {
        if (bestMoRank === null || moSerp.rank < bestMoRank) {
          bestMoRank = moSerp.rank
          bestMoChange = moSerp.rank_change || 0
          if (!accountName) accountName = content.account?.name || null
        }
      }
    })
    
    return {
      ...kw,
      contents: kwContents,
      pcRank: bestPcRank,
      moRank: bestMoRank,
      pcChange: bestPcChange,
      moChange: bestMoChange,
      accountName,
    }
  })

  const exposedCount = keywordsWithSerp.filter(k => k.pcRank !== null || k.moRank !== null).length
  const exposureRate = totalKeywords > 0 ? Math.round((exposedCount / totalKeywords) * 100) : 0
  const upCount = keywordsWithSerp.filter(k => k.pcChange > 0 || k.moChange > 0).length
  const downCount = keywordsWithSerp.filter(k => k.pcChange < 0 || k.moChange < 0).length

  // Top 상승/하락
  const topUp = [...keywordsWithSerp]
    .filter(k => k.pcChange > 0 || k.moChange > 0)
    .sort((a, b) => (b.pcChange + b.moChange) - (a.pcChange + a.moChange))
    .slice(0, 3)

  const topDown = [...keywordsWithSerp]
    .filter(k => k.pcChange < 0 || k.moChange < 0)
    .sort((a, b) => (a.pcChange + a.moChange) - (b.pcChange + b.moChange))
    .slice(0, 3)

  // 미노출 키워드
  const unexposed = keywordsWithSerp
    .filter(k => k.pcRank === null && k.moRank === null)
    .slice(0, 5)

  return (
    <div className="space-y-6">
      {/* 상태 배너 */}
      <div className={`rounded-xl p-4 ${!hasError ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-red-500/10 border border-red-500/30'}`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center">
            <div className={`w-3 h-3 rounded-full mr-3 ${!hasError ? 'bg-emerald-500 animate-pulse' : 'bg-red-500'}`} />
            <span className={!hasError ? 'text-emerald-400' : 'text-red-400'}>
              {!hasError ? '✅ 시스템 정상 작동 중' : '❌ 연결 오류'}
            </span>
          </div>
          <span className="text-slate-500 text-sm">{new Date().toLocaleString('ko-KR')}</span>
        </div>
      </div>

      {/* 액션 버튼 (클라이언트 컴포넌트) */}
      <DashboardActions />

      {/* KPI 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
        <StatCard title="등록 계정" value={totalAccounts} icon="👤" href="/dashboard/accounts" />
        <StatCard title="등록 키워드" value={totalKeywords} icon="🔑" href="/dashboard/keywords" />
        <StatCard title="평균 블로그 지수" value={avgBlogScore} icon="📊" href="/dashboard/accounts" />
        <StatCard title="노출률" value={`${exposureRate}%`} icon="👁️" href="/dashboard/rankings" color={exposureRate >= 70 ? 'emerald' : exposureRate >= 40 ? 'yellow' : 'red'} />
        <StatCard title="↑ 상승" value={upCount} icon="📈" href="/dashboard/rankings" color="green" />
        <StatCard title="↓ 하락" value={downCount} icon="📉" href="/dashboard/rankings" color="red" />
      </div>

      {/* 3단 레이아웃 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 계정 지수 */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">📋 계정 지수</h2>
            <Link href="/dashboard/accounts" className="text-sm text-purple-400 hover:text-purple-300">전체 →</Link>
          </div>
          <div className="divide-y divide-slate-700/50">
            {(accounts as Account[] || []).slice(0, 5).map((acc) => (
              <div key={acc.id} className="px-6 py-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={`w-2 h-2 rounded-full ${
                    acc.blog_score >= 70 ? 'bg-emerald-500' :
                    acc.blog_score >= 40 ? 'bg-yellow-500' : 'bg-slate-500'
                  }`} />
                  <span className="text-white">{acc.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-16 bg-slate-700 rounded-full h-1.5">
                    <div className={`h-1.5 rounded-full ${
                      acc.blog_score >= 70 ? 'bg-emerald-500' :
                      acc.blog_score >= 40 ? 'bg-yellow-500' : 'bg-slate-500'
                    }`} style={{ width: `${acc.blog_score}%` }} />
                  </div>
                  <span className="text-slate-400 text-sm w-8">{acc.blog_score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Top 상승/하락 */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">📈 순위 변동</h2>
            <Link href="/dashboard/rankings" className="text-sm text-purple-400 hover:text-purple-300">전체 →</Link>
          </div>
          <div className="p-4 space-y-4">
            {/* 상승 */}
            <div>
              <p className="text-green-400 text-xs font-medium mb-2">🚀 TOP 상승</p>
              {topUp.length === 0 ? (
                <p className="text-slate-500 text-sm">없음</p>
              ) : (
                <div className="space-y-1">
                  {topUp.map((k) => (
                    <div key={k.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 truncate max-w-[120px]">{k.keyword}</span>
                      <span className="text-green-400 font-mono">
                        {k.pcChange > 0 && `PC↑${k.pcChange}`}
                        {k.pcChange > 0 && k.moChange > 0 && ' '}
                        {k.moChange > 0 && `MO↑${k.moChange}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {/* 하락 */}
            <div>
              <p className="text-red-400 text-xs font-medium mb-2">📉 TOP 하락</p>
              {topDown.length === 0 ? (
                <p className="text-slate-500 text-sm">없음</p>
              ) : (
                <div className="space-y-1">
                  {topDown.map((k) => (
                    <div key={k.id} className="flex items-center justify-between text-sm">
                      <span className="text-slate-300 truncate max-w-[120px]">{k.keyword}</span>
                      <span className="text-red-400 font-mono">
                        {k.pcChange < 0 && `PC↓${Math.abs(k.pcChange)}`}
                        {k.pcChange < 0 && k.moChange < 0 && ' '}
                        {k.moChange < 0 && `MO↓${Math.abs(k.moChange)}`}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* 미노출 키워드 */}
        <div className="bg-slate-800/50 rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">⚠️ 미노출 키워드</h2>
            <Link href="/dashboard/recommendations" className="text-sm text-purple-400 hover:text-purple-300">추천 →</Link>
          </div>
          <div className="divide-y divide-slate-700/50">
            {unexposed.length === 0 ? (
              <div className="p-6 text-center">
                <p className="text-4xl mb-2">🎉</p>
                <p className="text-emerald-400">모든 키워드 노출 중!</p>
              </div>
            ) : (
              unexposed.map((k) => (
                <div key={k.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-white text-sm">{k.keyword}</p>
                    <p className="text-slate-500 text-xs">{k.accountName || '미지정'}</p>
                  </div>
                  <span className="text-slate-400 text-xs">
                    {k.monthly_search_total?.toLocaleString() || 0}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* 빠른 실행 */}
      <div className="bg-slate-800/50 rounded-xl border border-slate-700 p-6">
        <h2 className="text-lg font-semibold text-white mb-4">⚡ 빠른 이동</h2>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <Link href="/dashboard/keywords" className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition">
            <span className="text-2xl">🔑</span>
            <span className="text-white text-sm">키워드 관리</span>
          </Link>
          <Link href="/dashboard/rankings" className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition">
            <span className="text-2xl">📈</span>
            <span className="text-white text-sm">순위 변동</span>
          </Link>
          <Link href="/dashboard/recommendations" className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition">
            <span className="text-2xl">💡</span>
            <span className="text-white text-sm">발행 추천</span>
          </Link>
          <Link href="/dashboard/accounts" className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition">
            <span className="text-2xl">👤</span>
            <span className="text-white text-sm">계정 관리</span>
          </Link>
          <Link href="/dashboard/settings" className="flex flex-col items-center gap-2 p-4 bg-slate-700/50 rounded-lg hover:bg-slate-700 transition">
            <span className="text-2xl">⚙️</span>
            <span className="text-white text-sm">설정</span>
          </Link>
        </div>
      </div>
    </div>
  )
}

function StatCard({ 
  title, 
  value, 
  icon,
  href,
  color = 'default'
}: { 
  title: string
  value: number | string
  icon: string
  href: string
  color?: 'default' | 'emerald' | 'green' | 'yellow' | 'red'
}) {
  const colorClasses = {
    default: 'bg-slate-800/50 border-slate-700',
    emerald: 'bg-emerald-500/10 border-emerald-500/30',
    green: 'bg-green-500/10 border-green-500/30',
    yellow: 'bg-yellow-500/10 border-yellow-500/30',
    red: 'bg-red-500/10 border-red-500/30',
  }
  
  return (
    <Link href={href} className={`rounded-xl border p-4 hover:opacity-80 transition ${colorClasses[color]}`}>
      <div className="flex items-center justify-between">
        <div>
          <p className="text-slate-400 text-xs">{title}</p>
          <p className="text-2xl font-bold text-white mt-1">{value}</p>
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </Link>
  )
}

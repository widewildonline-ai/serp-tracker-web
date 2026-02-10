'use client'

import { createClient } from '@/lib/supabase/client'
import { useRouter, usePathname } from 'next/navigation'
import { User } from '@supabase/supabase-js'
import Link from 'next/link'

const navItems = [
  { href: '/dashboard', label: '대시보드', icon: '📊' },
  { href: '/dashboard/keywords', label: '키워드', icon: '🔑' },
  { href: '/dashboard/publish', label: '발행 기록', icon: '📝' },
  { href: '/dashboard/rankings', label: '순위 변동', icon: '📈' },
  { href: '/dashboard/recommendations', label: '발행 추천', icon: '💡' },
  { href: '/dashboard/accounts', label: '계정', icon: '👤' },
  { href: '/dashboard/settings', label: '설정', icon: '⚙️' },
]

export default function DashboardNav({ user }: { user: User }) {
  const router = useRouter()
  const pathname = usePathname()
  const supabase = createClient()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const isActive = (href: string) => {
    if (href === '/dashboard') return pathname === '/dashboard'
    return pathname.startsWith(href)
  }

  return (
    <nav className="bg-slate-800 border-b border-slate-700">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center">
            <Link href="/dashboard" className="flex items-center">
              <div className="w-9 h-9 bg-gradient-to-br from-purple-600 to-pink-600 rounded-xl flex items-center justify-center mr-3 shadow-lg shadow-purple-500/20">
                <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
                </svg>
              </div>
              <span className="text-white font-bold text-lg hidden sm:block">SERP Tracker</span>
            </Link>
            
            {/* Nav Links */}
            <div className="hidden lg:flex ml-8 items-center space-x-1">
              {navItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition ${
                    isActive(item.href)
                      ? 'bg-slate-900 text-white'
                      : 'text-slate-400 hover:bg-slate-700 hover:text-white'
                  }`}
                >
                  <span>{item.icon}</span>
                  <span>{item.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* User Menu */}
          <div className="flex items-center gap-4">
            <div className="hidden sm:block text-right">
              <p className="text-white text-sm font-medium">{user.email?.split('@')[0]}</p>
              <p className="text-slate-500 text-xs">{user.email}</p>
            </div>
            <button
              onClick={handleLogout}
              className="bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white px-4 py-2 rounded-lg text-sm font-medium transition"
            >
              로그아웃
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Nav */}
      <div className="lg:hidden border-t border-slate-700 px-2 py-2 overflow-x-auto">
        <div className="flex items-center gap-1 min-w-max">
          {navItems.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs whitespace-nowrap ${
                isActive(item.href)
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-500 hover:bg-slate-700'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </nav>
  )
}

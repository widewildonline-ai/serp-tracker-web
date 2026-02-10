import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// EC2 서버 프록시 API
// CORS 문제를 우회하기 위해 서버사이드에서 EC2 요청

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const endpoint = '/' + path.join('/')
  
  try {
    const supabase = await createClient()
    
    // EC2 설정 가져오기
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ec2_api')
      .single()
    
    if (!settings?.value) {
      return NextResponse.json({ error: 'EC2 설정 없음' }, { status: 500 })
    }
    
    const config = settings.value as { base_url: string; secret: string }
    
    // EC2 서버에 요청
    const response = await fetch(`${config.base_url}${endpoint}`, {
      method: 'GET',
      headers: {
        'X-API-Secret': config.secret,
      },
    })
    
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
    
  } catch (error) {
    console.error('EC2 프록시 에러:', error)
    return NextResponse.json({ error: '서버 연결 실패' }, { status: 500 })
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params
  const endpoint = '/' + path.join('/')
  
  try {
    const supabase = await createClient()
    
    // EC2 설정 가져오기
    const { data: settings } = await supabase
      .from('settings')
      .select('value')
      .eq('key', 'ec2_api')
      .single()
    
    if (!settings?.value) {
      return NextResponse.json({ error: 'EC2 설정 없음' }, { status: 500 })
    }
    
    const config = settings.value as { base_url: string; secret: string }
    
    // 요청 바디 파싱
    let body = {}
    try {
      body = await request.json()
    } catch {
      // 빈 바디
    }
    
    // secret 추가
    const requestBody = {
      ...body,
      secret: config.secret,
    }
    
    // EC2 서버에 요청
    const response = await fetch(`${config.base_url}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Secret': config.secret,
      },
      body: JSON.stringify(requestBody),
    })
    
    const data = await response.json()
    return NextResponse.json(data, { status: response.status })
    
  } catch (error) {
    console.error('EC2 프록시 에러:', error)
    return NextResponse.json({ error: '서버 연결 실패' }, { status: 500 })
  }
}

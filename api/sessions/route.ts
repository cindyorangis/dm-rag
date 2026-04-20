import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// POST /api/sessions — create a new session
export async function POST(req: NextRequest) {
  try {
    const now = new Date()
    const title = `Session — ${now.toLocaleDateString('en-CA', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })}`

    const { data, error } = await supabase
      .from('sessions')
      .insert({ title, status: 'active' })
      .select('id')
      .single()

    if (error) throw new Error(error.message)

    return NextResponse.json({ sessionId: data.id })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

// GET /api/sessions — list all sessions (for journal page)
export async function GET() {
  try {
    const { data, error } = await supabase
      .from('sessions')
      .select('id, title, created_at, status, journal_entry')
      .order('created_at', { ascending: false })

    if (error) throw new Error(error.message)

    return NextResponse.json({ sessions: data })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
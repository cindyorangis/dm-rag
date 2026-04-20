'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'

type Session = {
  id: string
  title: string
  created_at: string
  status: 'active' | 'complete'
  journal_entry: string | null
}

export default function JournalPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/sessions')
      .then((r) => r.json())
      .then(({ sessions, error }) => {
        if (error) throw new Error(error)
        setSessions(sessions)
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [])

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-10">

        {/* Header */}
        <div className="space-y-1">
          <Link
            href="/"
            className="text-stone-500 hover:text-stone-300 text-xs tracking-widest uppercase transition-colors"
          >
            ← Back
          </Link>
          <h1 className="text-3xl font-serif text-amber-400 tracking-wide">
            Campaign Journal
          </h1>
          <p className="text-stone-500 text-sm italic">
            A record of your adventures in the Forgotten Realms
          </p>
        </div>

        {/* States */}
        {loading && (
          <p className="text-stone-500 text-sm italic">Consulting the archives...</p>
        )}

        {error && (
          <p className="text-red-400 text-sm">{error}</p>
        )}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <p className="text-stone-500 italic font-serif">No adventures recorded yet.</p>
            <Link
              href="/"
              className="inline-block text-amber-600 hover:text-amber-400 text-sm transition-colors"
            >
              Begin your first session →
            </Link>
          </div>
        )}

        {/* Session list */}
        <ul className="space-y-4">
          {sessions.map((session) => (
            <li key={session.id}>
              {session.status === 'complete' ? (
                <Link href={`/journal/${session.id}`}>
                  <SessionCard session={session} />
                </Link>
              ) : (
                <Link href={`/session/${session.id}`}>
                  <SessionCard session={session} />
                </Link>
              )}
            </li>
          ))}
        </ul>

      </div>
    </div>
  )
}

function SessionCard({ session }: { session: Session }) {
  const date = new Date(session.created_at).toLocaleDateString('en-CA', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const excerpt = session.journal_entry
    ? session.journal_entry.slice(0, 160).trimEnd() + '...'
    : null

  return (
    <div className="group border border-stone-800 hover:border-amber-800 bg-stone-900 hover:bg-stone-900/80 rounded-lg px-5 py-4 transition-colors cursor-pointer">
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-1 flex-1 min-w-0">
          <p className="font-serif text-stone-200 group-hover:text-amber-300 transition-colors truncate">
            {session.title}
          </p>
          {excerpt && (
            <p className="text-stone-500 text-xs leading-relaxed line-clamp-2 italic">
              {excerpt}
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <span className="text-stone-600 text-xs">{date}</span>
          <StatusBadge status={session.status} />
        </div>
      </div>
    </div>
  )
}

function StatusBadge({ status }: { status: 'active' | 'complete' }) {
  if (status === 'active') {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-500">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        In progress
      </span>
    )
  }
  return (
    <span className="text-xs text-stone-600">Complete</span>
  )
}
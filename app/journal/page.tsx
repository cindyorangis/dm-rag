"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import SessionCard from "./components/SessionCard";

type Session = {
  id: string;
  title: string;
  created_at: string;
  status: "active" | "complete";
  journal_entry: string | null;
};

export default function JournalPage() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/sessions")
      .then((r) => r.json())
      .then(({ sessions, error }) => {
        if (error) throw new Error(error);
        setSessions(sessions);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

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
          <p className="text-stone-500 text-sm italic">
            Consulting the archives...
          </p>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {!loading && !error && sessions.length === 0 && (
          <div className="text-center py-20 space-y-3">
            <p className="text-stone-500 italic font-serif">
              No adventures recorded yet.
            </p>
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
              {session.status === "complete" ? (
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
  );
}

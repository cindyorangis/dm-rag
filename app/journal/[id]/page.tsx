"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Session = {
  id: string;
  title: string;
  created_at: string;
  journal_entry: string;
  status: "active" | "complete";
};

export default function JournalEntryPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/journal/${id}`)
      .then((r) => r.json())
      .then(({ session, error }) => {
        if (error) throw new Error(error);
        setSession(session);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [id]);

  const date = session
    ? new Date(session.created_at).toLocaleDateString("en-CA", {
        weekday: "long",
        month: "long",
        day: "numeric",
        year: "numeric",
      })
    : null;

  return (
    <div className="min-h-screen bg-stone-950 text-stone-100 px-4 py-12">
      <div className="max-w-2xl mx-auto space-y-10">
        {/* Nav */}
        <Link
          href="/journal"
          className="text-stone-500 hover:text-stone-300 text-xs tracking-widest uppercase transition-colors"
        >
          ← Journal
        </Link>

        {/* States */}
        {loading && (
          <p className="text-stone-500 text-sm italic">
            Unrolling the scroll...
          </p>
        )}

        {error && <p className="text-red-400 text-sm">{error}</p>}

        {/* Entry */}
        {session && (
          <article className="space-y-8">
            {/* Header */}
            <div className="border-b border-stone-800 pb-6 space-y-2">
              <p className="text-stone-500 text-xs tracking-widest uppercase">
                {date}
              </p>
              <h1 className="text-3xl font-serif text-amber-400 tracking-wide">
                {session.title}
              </h1>
            </div>

            {/* Journal body */}
            <div className="prose prose-invert prose-stone max-w-none">
              {session.journal_entry
                .split("\n\n")
                .filter(Boolean)
                .map((paragraph, i) => (
                  <p
                    key={i}
                    className="font-serif text-stone-300 leading-8 text-base first-letter:text-3xl first-letter:font-bold first-letter:text-amber-400 first-letter:float-left first-letter:mr-2 first-letter:leading-none [&:not(:first-child)]:first-letter:text-base [&:not(:first-child)]:first-letter:font-normal [&:not(:first-child)]:first-letter:text-stone-300 [&:not(:first-child)]:first-letter:float-none [&:not(:first-child)]:first-letter:mr-0"
                  >
                    {paragraph}
                  </p>
                ))}
            </div>

            {/* Footer actions */}
            <div className="border-t border-stone-800 pt-6 flex justify-between items-center">
              <Link
                href="/journal"
                className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
              >
                ← All entries
              </Link>
              <div className="flex gap-4">
                <CopyButton text={session.journal_entry} />
                <Link
                  href="/"
                  className="text-amber-700 hover:text-amber-500 text-sm transition-colors"
                >
                  New session →
                </Link>
              </div>
            </div>
          </article>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={copy}
      className="text-stone-500 hover:text-stone-300 text-sm transition-colors"
    >
      {copied ? "Copied ✓" : "Copy entry"}
    </button>
  );
}

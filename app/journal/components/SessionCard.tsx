import StatusBadge from "./StatusBadge";

type Session = {
  id: string;
  title: string;
  created_at: string;
  status: "active" | "complete";
  journal_entry: string | null;
};

export default function SessionCard({ session }: { session: Session }) {
  const date = new Date(session.created_at).toLocaleDateString("en-CA", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });

  const excerpt = session.journal_entry
    ? session.journal_entry.slice(0, 160).trimEnd() + "..."
    : null;

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
  );
}

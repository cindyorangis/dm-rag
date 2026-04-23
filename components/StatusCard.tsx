"use client";

interface StatusCardProps {
  items: string[];
}

export function StatusCard({ items }: StatusCardProps) {
  if (!items.length) return null;
  return (
    <div className="mt-3 border border-amber-900/40 bg-amber-950/20 rounded-md overflow-hidden">
      <div className="px-3 py-1.5 border-b border-amber-900/30 bg-amber-950/30">
        <span className="text-[0.5rem] tracking-[0.2em] uppercase text-amber-700/80 font-sans">
          Quest Status
        </span>
      </div>
      <ul className="px-3 py-2 space-y-1">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 text-xs font-serif text-stone-400"
          >
            <span className="text-amber-800/60 mt-0.5 shrink-0">◆</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

"use client";

interface StatusCardProps {
  items: string[];
}

export function StatusCard({ items }: StatusCardProps) {
  if (!items.length) return null;
  return (
    <div className="mt-3 overflow-hidden rounded-md border border-amber-700/50 bg-amber-950/25">
      <div className="border-b border-amber-700/40 bg-amber-950/40 px-3 py-2">
        <span className="text-xs uppercase tracking-[0.14em] text-amber-200">
          Quest Status
        </span>
      </div>
      <ul className="space-y-1 px-3 py-2.5">
        {items.map((item, i) => (
          <li
            key={i}
            className="flex items-start gap-2 font-serif text-sm text-stone-100"
          >
            <span className="mt-0.5 shrink-0 text-amber-300">-</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function StatBlock({
  label,
  value,
  mod,
}: {
  label: string;
  value?: string;
  mod: string;
}) {
  return (
    <div className="flex flex-col items-center bg-black/40 border border-amber-950/50 rounded p-1.5 gap-0.5">
      <span className="text-[0.5rem] tracking-widest uppercase text-amber-900/70 font-sans">
        {label}
      </span>
      <span className="text-amber-200/90 font-serif text-sm leading-none">
        {value || "—"}
      </span>
      <span className="text-[0.6rem] text-amber-700/80 font-sans">{mod}</span>
    </div>
  );
}

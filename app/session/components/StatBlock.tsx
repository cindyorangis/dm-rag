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
    <div className="flex flex-col items-center gap-0.5 rounded border border-stone-700/70 bg-black/35 p-2">
      <span className="text-[0.65rem] uppercase tracking-[0.12em] text-amber-200/90">
        {label}
      </span>
      <span className="font-serif text-base leading-none text-stone-100">
        {value || "-"}
      </span>
      <span className="text-xs text-amber-200/90">{mod}</span>
    </div>
  );
}

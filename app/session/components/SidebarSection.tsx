export default function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-md border border-stone-700/70 bg-stone-900/35">
      <div className="border-b border-stone-700/70 bg-stone-900/80 px-3 py-2">
        <span className="text-xs uppercase tracking-[0.14em] text-amber-200/90">
          {title}
        </span>
      </div>
      <div className="p-3.5">{children}</div>
    </div>
  );
}

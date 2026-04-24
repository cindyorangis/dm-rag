export default function SidebarSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border border-amber-950/50 rounded-md overflow-hidden">
      <div className="bg-amber-950/30 px-3 py-1.5 border-b border-amber-950/50">
        <span className="text-[0.55rem] tracking-[0.2em] uppercase text-amber-800/80 font-sans">
          {title}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

export default function StatusBadge({
  status,
}: {
  status: "active" | "complete";
}) {
  if (status === "active") {
    return (
      <span className="flex items-center gap-1 text-xs text-emerald-500">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
        In progress
      </span>
    );
  }
  return <span className="text-xs text-stone-600">Complete</span>;
}

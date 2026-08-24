export function StatTile({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel?: string;
}) {
  return (
    <div className="rounded-xl border border-border-hairline bg-surface-card px-4 py-3">
      <p className="text-xs font-medium tracking-wide text-text-muted uppercase">{label}</p>
      <p className="mt-1 font-mono text-2xl font-semibold text-text-primary tabular-nums">{value}</p>
      {sublabel && <p className="mt-0.5 text-xs text-text-secondary">{sublabel}</p>}
    </div>
  );
}

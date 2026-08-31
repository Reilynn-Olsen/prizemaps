import { categoryForKind, formatKindLabel, CATEGORY_DOT_CLASS } from "@/lib/event-style";

export type MatchEvent = {
  id: number;
  sequence: number;
  kind: string;
  raw_line: string | null;
  payload: Record<string, unknown> | null;
};

export function EventRow({ event }: { event: MatchEvent }) {
  const category = categoryForKind(event.kind);
  const details = (event.payload?.details as string[] | undefined) ?? [];

  return (
    <li className="flex gap-3 py-1.5">
      <span
        aria-hidden
        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${CATEGORY_DOT_CLASS[category]}`}
        title={formatKindLabel(event.kind)}
      />
      <div className="min-w-0">
        <p className="text-sm text-text-primary">{event.raw_line ?? formatKindLabel(event.kind)}</p>
        {details.length > 0 && (
          <ul className="mt-0.5 flex flex-col gap-0.5">
            {details.map((detail, i) => (
              <li key={i} className="text-xs text-text-secondary">
                {detail}
              </li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

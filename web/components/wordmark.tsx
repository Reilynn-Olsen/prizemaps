export function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
      <span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent-strong text-accent-ink">
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5 fill-current">
          <path d="M4 2.5v11l9-5.5z" />
        </svg>
      </span>
      <span className="text-text-primary">
        Prize <span className="text-accent">Map</span>
      </span>
    </span>
  );
}

export function TopoBackground({ className = "" }: { className?: string }) {
  const rings = [40, 80, 120, 160, 200, 240];
  return (
    <svg
      viewBox="0 0 600 400"
      className={`pointer-events-none absolute inset-0 h-full w-full opacity-[0.18] ${className}`}
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      {rings.map((r, i) => (
        <ellipse key={i} cx="440" cy="90" rx={r * 1.3} ry={r} fill="none" stroke="#C99A3A" strokeWidth="1" />
      ))}
      {rings.map((r, i) => (
        <ellipse key={`b${i}`} cx="120" cy="340" rx={r} ry={r * 0.8} fill="none" stroke="#4E9E8B" strokeWidth="1" />
      ))}
    </svg>
  );
}

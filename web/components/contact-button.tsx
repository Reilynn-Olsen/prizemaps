// Landing-page footer contact link. Pure CSS hover (no client JS) so it can
// stay in the server-rendered page. Palette matches the "surveyor's map"
// look from globals.css — brass on ink, hairline border.
export function ContactButton({ email = "reilynn@prizemaps.app" }: { email?: string }) {
  return (
    <a
      href={`mailto:${email}`}
      className={
        "group inline-flex items-center gap-2 border border-[#3A4238] px-3.5 py-2 " +
        "text-xs uppercase tracking-wide text-[#C99A3A] transition-colors " +
        "hover:border-[#5A6350] hover:bg-[#241D12] hover:text-[#E0B25A]"
      }
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        className="transition-transform group-hover:-translate-y-px"
      >
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
      </svg>
      Contact me
    </a>
  );
}

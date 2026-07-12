export function DemoBanner() {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3.5 sm:px-5">
      <p className="text-[13px] leading-relaxed text-amber-950">
        <span className="font-semibold">Demo mode — billing is not connected yet. </span>
        <span className="text-amber-900/80">
          Licenses come from the license server prototype. No payment required. Files on your
          self-hosted instance are never locked by licensing.
        </span>
      </p>
    </div>
  )
}

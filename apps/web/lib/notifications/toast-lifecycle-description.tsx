"use client"

export function ToastLifecycleDescription({
  text,
  progress,
}: {
  text: string
  progress: number
}) {
  const pct = Math.max(0, Math.min(100, Math.round(progress)))

  return (
    <div className="arciin-toast-lifecycle">
      <p className="arciin-toast-lifecycle-text">{text}</p>
      <div
        className="arciin-toast-progress-track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-label={`Download progress ${pct} percent`}
      >
        <div className="arciin-toast-progress-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="arciin-toast-progress-label">{pct}%</span>
    </div>
  )
}

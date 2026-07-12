"use client"

export function SettingsPanelError({
  message,
  hint,
}: {
  message: string
  hint?: string
}) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-800">
      <p className="font-medium">{message}</p>
      {hint ? <p className="mt-1 text-[12px] text-red-700/90">{hint}</p> : null}
    </div>
  )
}

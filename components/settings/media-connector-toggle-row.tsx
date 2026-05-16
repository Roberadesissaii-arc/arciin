"use client"

/** Shared toggle copy and layout so Plex/Jellyfin cards stay the same height. */
export const MEDIA_CONNECTOR_HEADER_BLURB =
  "One switch: create folders in Videos, Images, and Music, route uploads there, and mirror files on disk for your media server."

export const MEDIA_CONNECTOR_TOGGLE_DESCRIPTION =
  "On: folders are created if needed, uploads go there, and files mirror on disk. Off: disconnect only—folders and files on disk stay; new uploads use normal library folders."

export function MediaConnectorToggleRow({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="flex w-full shrink-0 cursor-pointer items-start gap-4 rounded-xl border border-border px-4 py-3.5 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <div
        className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors"
        style={{
          borderColor: checked ? "#FF4F12" : "#d4d4d8",
          background: checked ? "#FF4F12" : "transparent",
        }}
      >
        {checked ? (
          <svg viewBox="0 0 10 8" className="size-2.5" xmlns="http://www.w3.org/2000/svg" aria-hidden>
            <path
              d="M1 4l2.5 2.5L9 1"
              stroke="white"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </svg>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 min-h-[4.25rem] text-[12px] leading-snug text-muted-foreground">
          {MEDIA_CONNECTOR_TOGGLE_DESCRIPTION}
        </p>
      </div>
    </button>
  )
}

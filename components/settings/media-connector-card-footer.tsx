"use client"

type MediaConnectorCardFooterProps = {
  enabled: boolean
  displayName: string
  hasReadyFolders: boolean
}

export function MediaConnectorCardFooter({
  enabled,
  displayName,
  hasReadyFolders,
}: MediaConnectorCardFooterProps) {
  return (
    <p
      className="mt-auto min-h-[2.75rem] shrink-0 text-xs leading-relaxed text-muted-foreground"
      aria-live="polite"
    >
      {enabled ? (
        <>
          <span className="font-medium text-foreground">Connected.</span> {displayName} is routing and mirroring new
          uploads to {displayName} folders in Videos, Images, and Music.
        </>
      ) : hasReadyFolders ? (
        <>
          <span className="font-medium text-foreground">Disconnected.</span> {displayName} folders remain in your
          libraries. Turn this on again to route and mirror new uploads.
        </>
      ) : (
        <>
          <span className="font-medium text-foreground">Disconnected.</span> Turn on {displayName} folders above to
          create library paths on this server.
        </>
      )}
    </p>
  )
}

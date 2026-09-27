"use client"

import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { ConnectorHealth, ConnectorHealthState } from "@/lib/api/integrations"
import { cn } from "@/lib/utils"

/**
 * One source for what a media connector's state looks like.
 *
 * healthy = success, degraded = warning, error = destructive,
 * disconnected = muted. The badge and the notice are driven by the same
 * server-computed state, so the card can no longer say "Connected" in green
 * directly above a warning that folders are missing.
 */

const LABEL: Record<ConnectorHealthState, string> = {
  healthy: "Healthy",
  degraded: "Degraded",
  error: "Error",
  disconnected: "Disconnected",
}

const BADGE: Record<ConnectorHealthState, string> = {
  healthy: "border-success/30 bg-success/10 text-success",
  degraded: "border-warning/40 bg-warning/10 text-warning",
  error: "border-destructive/30 bg-destructive/10 text-destructive",
  disconnected: "border-border bg-muted text-muted-foreground",
}

export function MediaConnectorHealthBadge({
  health,
  loading,
}: {
  health?: ConnectorHealth
  loading?: boolean
}) {
  if (loading || !health) {
    return (
      <Badge variant="outline" className="shrink-0 gap-1 border-border text-muted-foreground">
        <Loader2 className="animate-spin" aria-hidden />
        Checking
      </Badge>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn("shrink-0 font-semibold", BADGE[health.state])}
      data-testid="connector-health-badge"
      data-state={health.state}
    >
      {LABEL[health.state]}
    </Badge>
  )
}

export function MediaConnectorHealthNotice({
  health,
  onRepair,
  repairing,
  disabled,
}: {
  health?: ConnectorHealth
  onRepair: () => void
  repairing: boolean
  disabled: boolean
}) {
  if (!health || health.state === "disconnected") return null

  const tone =
    health.state === "healthy"
      ? "border-success/25 bg-success/5"
      : health.state === "degraded"
        ? "border-warning/35 bg-warning/5"
        : "border-destructive/30 bg-destructive/5"
  const Icon =
    health.state === "healthy" ? CheckCircle2 : health.state === "degraded" ? AlertTriangle : XCircle
  const iconTone =
    health.state === "healthy"
      ? "text-success"
      : health.state === "degraded"
        ? "text-warning"
        : "text-destructive"

  return (
    <div
      className={cn("rounded-xl border px-3 py-2.5 text-sm text-foreground", tone)}
      role={health.state === "healthy" ? "status" : "alert"}
      data-testid="connector-health-notice"
    >
      <p className="flex items-start gap-2">
        <Icon className={cn("mt-0.5 size-4 shrink-0", iconTone)} aria-hidden />
        <span>{health.reason}</span>
      </p>
      {health.state !== "healthy" ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="mt-2 bg-card"
          disabled={disabled}
          onClick={onRepair}
        >
          {repairing ? (
            <>
              <Loader2 className="mr-2 size-4 animate-spin" />
              Repairing…
            </>
          ) : (
            "Repair folders"
          )}
        </Button>
      ) : null}
    </div>
  )
}

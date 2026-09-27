"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Upload } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import {
  SettingsCard,
  SettingsFieldLabel,
  SettingsHint,
} from "@/components/settings/settings-panel-primitives"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { getUploadLimits, updateUploadLimits } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"

const PRESETS_GB = [2, 5, 10, 20] as const
const MB_PER_GB = 1024

/**
 * The largest single file anyone may upload — including people sending files
 * through a File Request link. It is a ceiling, not a promise: every upload is
 * also checked against the disk's real free space before it starts.
 */
export function UploadLimitSettings({ availableBytes }: { availableBytes?: number | null }) {
  const queryClient = useQueryClient()
  const role = useAuth().data?.user.role
  const canManage = role === "OWNER" || role === "ADMIN"
  const limitsQuery = useQuery({
    queryKey: queryKeys.uploadLimits,
    queryFn: ({ signal }) => getUploadLimits(signal),
  })
  const [customGb, setCustomGb] = useState("")
  const [customOpen, setCustomOpen] = useState(false)

  const mutation = useMutation({
    mutationFn: (maxUploadSizeMb: number) => updateUploadLimits({ maxUploadSizeMb }),
    onSuccess: async (data) => {
      queryClient.setQueryData(queryKeys.uploadLimits, data)
      await queryClient.invalidateQueries({ queryKey: queryKeys.uploadLimits })
      setCustomOpen(false)
      setCustomGb("")
      toast.success("Maximum upload size saved.", {
        description: `Files up to ${formatBytes(data.maxUploadSizeBytes)} are accepted.`,
      })
    },
    onError: (err) => {
      toast.error("Could not save the upload limit", {
        description: err instanceof Error ? err.message : "Try again in a moment.",
      })
    },
  })

  if (limitsQuery.isPending) {
    return (
      <SettingsCard>
        <Skeleton className="h-5 w-48" />
        <Skeleton className="mt-3 h-9 w-full" />
      </SettingsCard>
    )
  }
  if (limitsQuery.isError) {
    return (
      <SettingsCard>
        <p className="text-sm text-muted-foreground">Upload limits could not be loaded.</p>
      </SettingsCard>
    )
  }

  const currentMb = limitsQuery.data.maxUploadSizeMb
  const isPreset = PRESETS_GB.some((gb) => gb * MB_PER_GB === currentMb)
  const customValue = Number(customGb)
  const customValid = Number.isFinite(customValue) && customValue > 0 && customValue <= 1024

  return (
    <SettingsCard>
      <div className="mb-3 flex items-center gap-2">
        <Upload className="size-4 text-muted-foreground" />
        <h3 className="text-sm font-semibold text-foreground">Maximum upload file size</h3>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-muted-foreground">
        The largest single file that can be uploaded, including through File Request links.
        Large files are sent in small resumable pieces, so an interrupted upload continues where
        it stopped.
      </p>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Maximum upload file size">
        {PRESETS_GB.map((gb) => {
          const active = currentMb === gb * MB_PER_GB
          return (
            <Button
              key={gb}
              type="button"
              size="sm"
              variant="outline"
              aria-pressed={active}
              disabled={!canManage || mutation.isPending}
              onClick={() => mutation.mutate(gb * MB_PER_GB)}
              className={cn(active && "border-primary/50 bg-primary/10 text-foreground")}
            >
              {gb} GB
            </Button>
          )
        })}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={!isPreset}
          aria-expanded={customOpen}
          disabled={!canManage || mutation.isPending}
          onClick={() => setCustomOpen((open) => !open)}
          className={cn(!isPreset && "border-primary/50 bg-primary/10 text-foreground")}
        >
          {isPreset ? "Custom" : `Custom · ${formatBytes(limitsQuery.data.maxUploadSizeBytes)}`}
        </Button>
      </div>

      {customOpen ? (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center"
          onSubmit={(e) => {
            e.preventDefault()
            if (customValid) mutation.mutate(Math.round(customValue * MB_PER_GB))
          }}
        >
          <label className="sr-only" htmlFor="custom-upload-limit">
            Custom maximum in GB
          </label>
          <Input
            id="custom-upload-limit"
            inputMode="decimal"
            placeholder="Size in GB, e.g. 50"
            value={customGb}
            onChange={(e) => setCustomGb(e.target.value)}
            className="sm:max-w-[200px]"
          />
          <Button type="submit" size="sm" disabled={!customValid || mutation.isPending}>
            Save
          </Button>
        </form>
      ) : null}

      <div className="mt-4 space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2.5">
          <SettingsFieldLabel>Current limit</SettingsFieldLabel>
          <span className="text-sm font-semibold tabular-nums text-foreground">
            {formatBytes(limitsQuery.data.maxUploadSizeBytes)}
          </span>
        </div>
        {availableBytes != null && availableBytes < limitsQuery.data.maxUploadSizeBytes ? (
          <SettingsHint>
            The disk has {formatBytes(availableBytes)} free, which is less than this limit. Uploads
            that would not fit are refused before they start.
          </SettingsHint>
        ) : (
          <SettingsHint>
            Every upload is also checked against the disk&apos;s free space before it starts.
          </SettingsHint>
        )}
        <SettingsHint>
          Unfinished uploads can be resumed for up to a day, then their partial data is removed.
        </SettingsHint>
        {!canManage ? (
          <SettingsHint>Only an owner or admin can change this.</SettingsHint>
        ) : null}
      </div>
    </SettingsCard>
  )
}

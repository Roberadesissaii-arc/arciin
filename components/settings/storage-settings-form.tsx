"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { getStorageSettings, updateStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { formatBytes } from "@/lib/utils/format-bytes"

export function StorageSettingsForm() {
  const queryClient = useQueryClient()
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })
  const [storageRoot, setStorageRoot] = useState("")
  const updateMutation = useMutation({
    mutationFn: updateStorageSettings,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.storageSettings,
      })
    },
  })

  const effectiveValue = storageRoot || storageQuery.data?.storageRoot || ""

  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-white">Storage settings</CardTitle>
        <CardDescription className="text-zinc-400">
          Update the managed root path and check current object usage.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {storageQuery.data ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Usage</div>
              <div className="mt-2 text-xl font-semibold text-white">
                {formatBytes(storageQuery.data.usageBytes)}
              </div>
              {storageQuery.data.totalBytes ? (
                <div className="mt-1 text-xs text-zinc-500">
                  of {formatBytes(storageQuery.data.totalBytes)} total
                </div>
              ) : null}
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Available</div>
              <div className="mt-2 text-xl font-semibold text-white">
                {storageQuery.data.availableBytes != null
                  ? formatBytes(storageQuery.data.availableBytes)
                  : "—"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">free on disk</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Objects</div>
              <div className="mt-2 text-xl font-semibold text-white">
                {storageQuery.data.objectCount.toLocaleString()}
              </div>
              <div className="mt-1 text-xs text-zinc-500">stored files</div>
            </div>
            <div className="rounded-2xl border border-white/8 bg-black/20 p-4">
              <div className="text-sm text-zinc-400">Write status</div>
              <div className={`mt-2 text-xl font-semibold ${storageQuery.data.writable ? "text-emerald-400" : "text-red-400"}`}>
                {storageQuery.data.writable ? "Writable" : "Unavailable"}
              </div>
              <div className="mt-1 text-xs text-zinc-500">storage root</div>
            </div>
          </div>
        ) : null}
        <Field>
          <FieldLabel htmlFor="storageRoot">Storage root</FieldLabel>
          <Input
            id="storageRoot"
            value={effectiveValue}
            onChange={(event) => setStorageRoot(event.target.value)}
          />
        </Field>
        <Button
          className="bg-primary text-white hover:bg-primary/90"
          disabled={updateMutation.isPending || !effectiveValue}
          onClick={async () => {
            try {
              await updateMutation.mutateAsync(effectiveValue)
              toast.success("Storage settings updated.")
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Could not update storage.")
            }
          }}
        >
          {updateMutation.isPending ? "Saving..." : "Save storage settings"}
        </Button>
      </CardContent>
    </Card>
  )
}

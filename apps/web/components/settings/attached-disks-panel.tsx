"use client"

import { useQuery } from "@tanstack/react-query"
import { HardDrive } from "lucide-react"

import { StorageMigratePanel } from "@/components/settings/storage-migrate-panel"
import { SectionHeader } from "@/components/settings/settings-panel-primitives"
import { Skeleton } from "@/components/ui/skeleton"
import { getStorageSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * Attached disks — physical drives, mounting, and moving libraries to another disk.
 * Split out of the Storage tab so day-to-day storage stays short and disk operations
 * have a dedicated home.
 */
export function AttachedDisksPanel() {
  const storageQuery = useQuery({
    queryKey: queryKeys.storageSettings,
    queryFn: ({ signal }) => getStorageSettings(signal),
  })

  return (
    <div className="space-y-6 p-1">
      <SectionHeader
        icon={HardDrive}
        title="Attached disks"
        description="Every physical disk on this server — system disk, attached SSDs, and USB drives. Mount a new drive and transfer your libraries without touching a terminal."
      />

      {storageQuery.isLoading ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <StorageMigratePanel usageBytes={storageQuery.data?.usageBytes ?? 0} />
      )}
    </div>
  )
}

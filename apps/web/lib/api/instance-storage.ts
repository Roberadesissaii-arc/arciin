import { fetchApi } from "@/lib/api/client"
import type { StorageDiscovery, StoragePrepareResult } from "@/lib/types/models"

export function getStorageDiscovery(signal?: AbortSignal) {
  return fetchApi<StorageDiscovery>("/instance/storage-discovery", {
    method: "GET",
    signal,
  })
}

export function prepareStoragePath(path: string) {
  return fetchApi<StoragePrepareResult>("/instance/storage-prepare", {
    method: "POST",
    body: { path },
  })
}

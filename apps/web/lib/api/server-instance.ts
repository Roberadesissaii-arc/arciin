import "server-only"

import { fetchServerApi } from "@/lib/api/server"
import type { InstanceStatus } from "@/lib/types/models"

export function getServerInstanceStatus() {
  return fetchServerApi<InstanceStatus>("/instance/status")
}

import "server-only"

import { fetchServerApi } from "@/lib/api/server"
import type { AuthSession } from "@/lib/types/models"

export function getServerMe() {
  return fetchServerApi<AuthSession>("/auth/me")
}

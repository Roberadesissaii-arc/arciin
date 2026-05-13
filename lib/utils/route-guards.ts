import { ApiError } from "@/lib/api/errors"
import { getServerMe } from "@/lib/api/server-auth"
import { getServerInstanceStatus } from "@/lib/api/server-instance"
import type { AuthSession, InstanceStatus } from "@/lib/types/models"

export type RootRouteState =
  | { kind: "setup-required"; instance: InstanceStatus }
  | { kind: "unauthenticated"; instance: InstanceStatus }
  | { kind: "authenticated"; instance: InstanceStatus; auth: AuthSession }
  | { kind: "unavailable"; error: Error }

export async function getRootRouteState(): Promise<RootRouteState> {
  try {
    const instance = await getServerInstanceStatus()

    if (!instance.initialized) {
      return {
        kind: "setup-required",
        instance,
      }
    }

    try {
      const auth = await getServerMe()

      return {
        kind: "authenticated",
        instance,
        auth,
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        return {
          kind: "unauthenticated",
          instance,
        }
      }

      throw error
    }
  } catch (error) {
    return {
      kind: "unavailable",
      error: error instanceof Error ? error : new Error("The API is unavailable."),
    }
  }
}

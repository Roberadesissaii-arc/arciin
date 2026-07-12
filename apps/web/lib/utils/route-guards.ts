import { ApiError, isIpForbiddenError } from "@/lib/api/errors"
import { getServerMe } from "@/lib/api/server-auth"
import { getServerInstanceStatus } from "@/lib/api/server-instance"
import type { AuthSession, InstanceStatus } from "@/lib/types/models"

export type RootRouteState =
  | { kind: "setup-required"; instance: InstanceStatus }
  | { kind: "unauthenticated"; instance: InstanceStatus }
  | { kind: "authenticated"; instance: InstanceStatus; auth: AuthSession }
  | { kind: "ip-forbidden"; instance: InstanceStatus; message: string }
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

      if (isIpForbiddenError(error)) {
        return {
          kind: "ip-forbidden",
          instance,
          message: error.message,
        }
      }

      throw error
    }
  } catch (error) {
    if (isIpForbiddenError(error)) {
      try {
        const instance = await getServerInstanceStatus()
        return {
          kind: "ip-forbidden",
          instance,
          message: error.message,
        }
      } catch {
        return {
          kind: "ip-forbidden",
          instance: { initialized: true, setupRequired: false, instanceName: "Arciin", version: "" },
          message: error.message,
        }
      }
    }

    return {
      kind: "unavailable",
      error: error instanceof Error ? error : new Error("The API is unavailable."),
    }
  }
}

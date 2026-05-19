import "server-only"

import { headers } from "next/headers"

import { ApiError, toApiError } from "@/lib/api/errors"
import { isApiFailure, type ApiResponse } from "@/lib/types/api"

import { getServerApiOrigin } from "@/lib/server/api-origin"

const apiUrl = getServerApiOrigin()
const serverApiBase = `${apiUrl}/api`

async function parseServerResponse<T>(response: Response) {
  const text = await response.text()

  if (!text) {
    if (!response.ok) {
      throw new ApiError("The API returned an empty response.", {
        status: response.status,
        code: "EMPTY_RESPONSE",
      })
    }

    return undefined as T
  }

  let payload: ApiResponse<T>

  try {
    payload = JSON.parse(text) as ApiResponse<T>
  } catch {
    throw new ApiError("The API returned an invalid JSON response.", {
      status: response.status,
      code: "INVALID_JSON_RESPONSE",
    })
  }

  if (!response.ok || isApiFailure(payload)) {
    const error = "error" in payload
      ? payload.error
      : {
          code: "REQUEST_FAILED",
          message: response.statusText || "Request failed.",
        }

    throw toApiError(response.status, error)
  }

  return payload.data
}

export async function fetchServerApi<T>(
  path: string,
  init: RequestInit = {}
) {
  const headerStore = await headers()
  const requestHeaders = new Headers(init.headers)
  const cookieHeader = headerStore.get("cookie")
  const forwardedProto = headerStore.get("x-forwarded-proto")
  const forwardedHost = headerStore.get("x-forwarded-host")
  const host = headerStore.get("host")

  if (cookieHeader && !requestHeaders.has("cookie")) {
    requestHeaders.set("cookie", cookieHeader)
  }

  if (forwardedProto && !requestHeaders.has("x-forwarded-proto")) {
    requestHeaders.set("x-forwarded-proto", forwardedProto)
  }

  if (forwardedHost && !requestHeaders.has("x-forwarded-host")) {
    requestHeaders.set("x-forwarded-host", forwardedHost)
  }

  if (host && !requestHeaders.has("host")) {
    requestHeaders.set("host", host)
  }

  const response = await fetch(`${serverApiBase}${path}`, {
    ...init,
    headers: requestHeaders,
    cache: "no-store",
  })

  return parseServerResponse<T>(response)
}

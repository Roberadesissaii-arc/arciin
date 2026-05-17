import { ApiError, toApiError } from "@/lib/api/errors"
import { isApiFailure, type ApiResponse } from "@/lib/types/api"

const clientApiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"

type FetchApiOptions = Omit<RequestInit, "body"> & {
  body?: BodyInit | FormData | Record<string, unknown> | null
}

function isJsonBody(body: FetchApiOptions["body"]) {
  if (!body) {
    return false
  }

  if (typeof FormData !== "undefined" && body instanceof FormData) {
    return false
  }

  return typeof body === "object" && !(body instanceof Blob) && !(body instanceof URLSearchParams)
}

async function parseResponse<T>(response: Response) {
  const text = await response.text()

  if (!text) {
    if (!response.ok) {
      throw new ApiError("The server returned an empty response.", {
        status: response.status,
        code: "EMPTY_RESPONSE",
      })
    }

    return undefined as T
  }

  const payload = JSON.parse(text) as ApiResponse<T>

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

export async function fetchApi<T>(path: string, options: FetchApiOptions = {}) {
  const headers = new Headers(options.headers)
  let body: BodyInit | null | undefined = options.body as BodyInit | null | undefined

  if (isJsonBody(options.body)) {
    headers.set("content-type", "application/json")
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(`${clientApiBase}${path}`, {
      ...options,
      headers,
      body,
      credentials: "include",
    })
  } catch (cause) {
    throw new ApiError(
      "Could not reach the Arciin API. Check that the API is running and that this page can reach /api (or set NEXT_PUBLIC_ARCIIN_API_ORIGIN for direct access).",
      { status: 0, code: "NETWORK_ERROR", details: cause },
    )
  }

  return parseResponse<T>(response)
}

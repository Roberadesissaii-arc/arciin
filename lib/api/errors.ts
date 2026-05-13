import type { ApiErrorShape } from "@/lib/types/api"

export class ApiError extends Error {
  status: number
  code: string
  details?: unknown

  constructor(
    message: string,
    options?: {
      status?: number
      code?: string
      details?: unknown
    }
  ) {
    super(message)
    this.name = "ApiError"
    this.status = options?.status ?? 500
    this.code = options?.code ?? "UNKNOWN_ERROR"
    this.details = options?.details
  }
}

export function toApiError(status: number, error: ApiErrorShape) {
  return new ApiError(error.message, {
    status,
    code: error.code,
    details: error.details,
  })
}

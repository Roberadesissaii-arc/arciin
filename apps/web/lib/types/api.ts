export type ApiErrorShape = {
  code: string
  message: string
  details?: unknown
}

export type ApiSuccess<T> = {
  data: T
}

export type ApiFailure = {
  error: ApiErrorShape
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure

export function isApiFailure<T>(response: ApiResponse<T>): response is ApiFailure {
  return "error" in response
}

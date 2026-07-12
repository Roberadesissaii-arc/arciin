"use client"

import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useState } from "react"

import { ApiError } from "@/lib/api/errors"

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            // 4xx responses (auth, plan gates, not-found) are definitive — the
            // default 3-retry backoff kept skeletons on screen for seconds on
            // Free servers where gated endpoints answer 403 immediately.
            retry: (failureCount, error) => {
              if (
                error instanceof ApiError &&
                error.status >= 400 &&
                error.status < 500
              ) {
                return false
              }
              return failureCount < 2
            },
          },
        },
      })
  )

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
}

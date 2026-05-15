"use client"

import { QueryProvider } from "@/components/providers/query-provider"
import { AppearanceToaster } from "@/components/providers/appearance-toaster"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      {children}
      <AppearanceToaster />
    </QueryProvider>
  )
}

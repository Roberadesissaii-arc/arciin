"use client"

import { QueryProvider } from "@/components/providers/query-provider"
import { AppearanceToaster } from "@/components/providers/appearance-toaster"
import { ChunkLoadRecovery } from "@/components/providers/chunk-load-recovery"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ChunkLoadRecovery />
      {children}
      <AppearanceToaster />
    </QueryProvider>
  )
}

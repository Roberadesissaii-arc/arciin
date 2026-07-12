"use client"

import { QueryProvider } from "@/components/providers/query-provider"
import { AppearanceToaster } from "@/components/providers/appearance-toaster"
import { ChunkLoadRecovery } from "@/components/providers/chunk-load-recovery"
import { InstallAppPrompt } from "@/components/providers/install-app-prompt"
import { SwRegister } from "@/components/providers/sw-register"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ChunkLoadRecovery />
      {children}
      <AppearanceToaster />
      <SwRegister />
      <InstallAppPrompt />
    </QueryProvider>
  )
}

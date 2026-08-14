"use client"

import { QueryProvider } from "@/components/providers/query-provider"
import { AppearanceToaster } from "@/components/providers/appearance-toaster"
import { ChunkLoadRecovery } from "@/components/providers/chunk-load-recovery"
import { InstallAppPrompt } from "@/components/providers/install-app-prompt"
import { SwRegister } from "@/components/providers/sw-register"

import { BookTaskProvider } from "@/components/providers/book-task-provider"

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <QueryProvider>
      <ChunkLoadRecovery />
      <BookTaskProvider>{children}</BookTaskProvider>
      <AppearanceToaster />
      <SwRegister />
      <InstallAppPrompt />
    </QueryProvider>
  )
}

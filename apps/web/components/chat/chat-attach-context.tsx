"use client"

import { createContext, useContext } from "react"

import type { AssetSummary } from "@/lib/types/models"

export type ChatAttachContextValue = {
  /** Asset ids currently in the composer tray. */
  attachedIds: ReadonlySet<string>
  /** Asset currently loading into the tray (if any). */
  busyAssetId: string | null
  /** Attach a library asset from a chat list/card click. */
  attachAsset: (asset: AssetSummary) => void | Promise<void>
}

const ChatAttachContext = createContext<ChatAttachContextValue | null>(null)

export function ChatAttachProvider({
  value,
  children,
}: {
  value: ChatAttachContextValue
  children: React.ReactNode
}) {
  return <ChatAttachContext.Provider value={value}>{children}</ChatAttachContext.Provider>
}

export function useChatAttach(): ChatAttachContextValue | null {
  return useContext(ChatAttachContext)
}

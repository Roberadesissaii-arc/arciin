"use client"

import { useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Key, Copy, RotateCw, Trash2, X } from "lucide-react"

import { ApiKeyRevealPanel } from "@/components/settings/api-key-reveal-panel"
import { ApiKeyScopeBadges } from "@/components/settings/api-key-scope-badges"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { getApiKeys, revokeApiKey, rotateApiKey } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { notifyApiKey, notifyApiKeyError } from "@/lib/notifications/toast-actions"
import { copyTextNow } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"
import { formatRelativeDate } from "@/lib/utils/format-date"

const API_KEYS_GRID =
  "lg:grid lg:grid-cols-[minmax(5.5rem,1.1fr)_minmax(6.5rem,1fr)_minmax(0,1.45fr)_minmax(5rem,0.85fr)_minmax(7.5rem,1fr)] lg:items-center lg:gap-x-3"

type ConfirmAction = {
  kind: "rotate" | "revoke"
  id: string
  name: string
}

export function ApiKeysTable() {
  const queryClient = useQueryClient()
  const [confirm, setConfirm] = useState<ConfirmAction | null>(null)
  const [revealOpen, setRevealOpen] = useState(false)
  const [revealedKey, setRevealedKey] = useState<string | null>(null)
  const [revealKeyName, setRevealKeyName] = useState("")
  const [revealKeyScopes, setRevealKeyScopes] = useState<string[]>([])
  const rotateCopyFieldRef = useRef<HTMLInputElement>(null)

  const apiKeysQuery = useQuery({
    queryKey: queryKeys.apiKeys,
    queryFn: ({ signal }) => getApiKeys(signal),
  })

  const revokeMutation = useMutation({
    mutationFn: revokeApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys })
    },
  })

  const rotateMutation = useMutation({
    mutationFn: rotateApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.apiKeys })
    },
  })

  const apiKeys = apiKeysQuery.data ?? []

  const handleRevealClose = (open: boolean) => {
    setRevealOpen(open)
    if (!open) {
      setRevealedKey(null)
      setRevealKeyName("")
      setRevealKeyScopes([])
    }
  }

  return (
    <>
      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
        <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-4">
          <Key className="size-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Your keys</span>
          {apiKeys.length > 0 ? (
            <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {apiKeys.length} key{apiKeys.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>
        <p className="border-b border-border px-5 py-2 text-[12px] text-zinc-500">
          Prefix, scopes, and last use. Create new keys from the API access panel above.
        </p>

        <div
          className={cn(
            "grid grid-cols-[minmax(0,1fr)] border-b border-border bg-muted/20 px-5 py-2.5 text-[10px] font-bold uppercase tracking-wider text-zinc-500",
            API_KEYS_GRID,
          )}
        >
          <span>Name</span>
          <span className="hidden lg:inline">Prefix</span>
          <span>Scopes</span>
          <span className="hidden lg:inline">Last used</span>
          <span className="hidden text-right lg:inline">Actions</span>
        </div>

        {apiKeysQuery.isLoading ? (
          <div className="space-y-0 px-5 py-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="my-3 h-12 rounded-lg" />
            ))}
          </div>
        ) : apiKeysQuery.isError ? (
          <p className="px-5 py-10 text-center text-sm text-red-600">
            {apiKeysQuery.error instanceof Error
              ? apiKeysQuery.error.message
              : "Could not load API keys."}
          </p>
        ) : apiKeys.length === 0 ? (
          <Empty className="rounded-none border-0 py-12">
            <EmptyMedia variant="icon">
              <Key />
            </EmptyMedia>
            <EmptyHeader>
              <EmptyTitle>No API keys yet</EmptyTitle>
              <EmptyDescription>
                Create a key using the API access panel above to connect scripts, monitors, and automations.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="divide-y divide-border">
            {apiKeys.map((apiKey) => (
              <div
                key={apiKey.id}
                className={cn("grid grid-cols-1 gap-2 px-5 py-3.5", API_KEYS_GRID)}
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold text-foreground">{apiKey.name}</p>
                  <p className="mt-0.5 font-mono text-[11px] text-zinc-500 lg:hidden">{apiKey.keyPrefix}</p>
                </div>
                <span className="hidden font-mono text-[12px] leading-none text-foreground lg:inline">
                  {apiKey.keyPrefix}
                </span>
                <ApiKeyScopeBadges scopes={apiKey.scopes} />
                <span className="text-[12px] text-zinc-500 lg:text-zinc-600">
                  {apiKey.lastUsedAt ? formatRelativeDate(apiKey.lastUsedAt) : "Never"}
                  {/*
                    New keys are given a ninety-day expiry. Keys created before
                    that have none, and saying so is the point: a key that never
                    expires is a standing credential, and the only way to know
                    which ones those are is to show it.
                  */}
                  {apiKey.expiresAt ? (
                    <span className="mt-0.5 block text-[11px] text-zinc-500">
                      Expires {formatRelativeDate(apiKey.expiresAt)}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      No expiration
                    </span>
                  )}
                </span>
                <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border bg-card text-foreground hover:bg-muted/50"
                    disabled={rotateMutation.isPending}
                    onClick={() => setConfirm({ kind: "rotate", id: apiKey.id, name: apiKey.name })}
                  >
                    <RotateCw className="size-4" />
                    Rotate
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="border-border bg-card text-foreground hover:bg-muted/50"
                    disabled={revokeMutation.isPending}
                    onClick={() => setConfirm({ kind: "revoke", id: apiKey.id, name: apiKey.name })}
                  >
                    <Trash2 className="size-4" />
                    Revoke
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-zinc-200 bg-white text-zinc-900 shadow-xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-zinc-900">
              {confirm?.kind === "rotate" ? "Rotate API key?" : "Revoke API key?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-500">
              {confirm?.kind === "rotate" ? (
                <>
                  <span className="font-medium text-zinc-800">{confirm.name}</span> — the current secret
                  stops working immediately. You will get one chance to copy the new key.
                </>
              ) : (
                <>
                  <span className="font-medium text-zinc-800">{confirm?.name}</span> — integrations using
                  this key will fail until you replace it. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="border-zinc-100 bg-white">
            <AlertDialogCancel className="border-zinc-200 bg-zinc-50 text-zinc-700 hover:bg-zinc-100">
              Cancel
            </AlertDialogCancel>
            <Button
              type="button"
              className={
                confirm?.kind === "rotate"
                  ? "bg-primary text-primary-foreground hover:bg-primary/90"
                  : "bg-red-600 text-white hover:bg-red-700"
              }
              disabled={revokeMutation.isPending || rotateMutation.isPending}
              onClick={async () => {
                if (!confirm) {
                  return
                }
                try {
                  if (confirm.kind === "revoke") {
                    await revokeMutation.mutateAsync(confirm.id)
                    notifyApiKey("revoked", { name: confirm.name })
                    setConfirm(null)
                    return
                  }
                  const result = await rotateMutation.mutateAsync(confirm.id)
                  setConfirm(null)
                  setRevealKeyName(confirm.name)
                  setRevealKeyScopes(
                    apiKeys.find((key) => key.id === confirm.id)?.scopes ?? [],
                  )
                  setRevealedKey(result.rawKey)
                  setRevealOpen(true)
                  notifyApiKey("rotated", { name: confirm.name })
                } catch (error) {
                  notifyApiKeyError(error instanceof Error ? error.message : "Request failed.")
                }
              }}
            >
              {confirm?.kind === "rotate"
                ? rotateMutation.isPending
                  ? "Rotating…"
                  : "Rotate key"
                : revokeMutation.isPending
                  ? "Revoking…"
                  : "Revoke key"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Sheet open={revealOpen} onOpenChange={handleRevealClose}>
        <SheetContent
          side="right"
          showCloseButton={false}
          className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
        >
          <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </SheetClose>
            <SheetTitle className="text-[15px] font-semibold text-foreground">
              Copy your new API key
            </SheetTitle>
            <SheetDescription className="text-[13px] text-muted-foreground">
              Key &quot;{revealKeyName}&quot; — the previous secret no longer works. Copy the new value now.
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
            {revealedKey ? (
              <ApiKeyRevealPanel
                rawKey={revealedKey}
                keyName={revealKeyName}
                scopes={revealKeyScopes}
                copyFieldRef={rotateCopyFieldRef}
              />
            ) : null}
          </div>
          <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
            {revealedKey ? (
              <div className="flex w-full flex-col gap-2">
                <Button
                  type="button"
                  className="h-10 w-full bg-primary text-white hover:bg-primary/90"
                  onMouseDown={(event) => {
                    event.preventDefault()
                    const ok = copyTextNow(revealedKey, rotateCopyFieldRef.current)
                    if (ok) {
                      notifyApiKey("copied")
                    } else {
                      notifyApiKeyError("Click the key field, press Ctrl+A, then Ctrl+C (or Cmd+C).")
                    }
                  }}
                >
                  <Copy className="size-4" />
                  Copy key
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="h-10 w-full border-border"
                  onClick={() => handleRevealClose(false)}
                >
                  Done
                </Button>
              </div>
            ) : null}
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

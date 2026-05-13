"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { RotateCw, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { ApiKeyRawKeyBanner } from "@/components/settings/api-key-raw-key-banner"
import { CreateApiKeyDialog } from "@/components/settings/create-api-key-dialog"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { getApiKeys, revokeApiKey, rotateApiKey } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"
import { formatRelativeDate } from "@/lib/utils/format-date"

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
    }
  }

  return (
    <>
      <Card className="border-white/8 bg-white/[0.02]">
        <CardHeader className="flex-row items-center justify-between">
          <div>
            <CardTitle className="text-white">API keys</CardTitle>
            <CardDescription className="text-zinc-400">
              Show the raw key once when created or rotated; manage by prefix and scope.
            </CardDescription>
          </div>
          <CreateApiKeyDialog />
        </CardHeader>
        <CardContent>
          {apiKeysQuery.isLoading ? (
            <Skeleton className="h-56 rounded-3xl" />
          ) : apiKeysQuery.isError ? (
            <div className="rounded-2xl border border-red-500/20 bg-red-500/5 p-4 text-sm text-red-200">
              {apiKeysQuery.error instanceof Error
                ? apiKeysQuery.error.message
                : "Could not load API keys."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-white/8 hover:bg-transparent">
                  <TableHead className="text-zinc-400">Name</TableHead>
                  <TableHead className="text-zinc-400">Prefix</TableHead>
                  <TableHead className="text-zinc-400">Scopes</TableHead>
                  <TableHead className="text-zinc-400">Last used</TableHead>
                  <TableHead className="text-right text-zinc-400">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apiKeys.map((apiKey) => (
                  <TableRow key={apiKey.id} className="border-white/8 hover:bg-white/[0.02]">
                    <TableCell className="font-medium text-white">{apiKey.name}</TableCell>
                    <TableCell className="font-mono text-zinc-300">{apiKey.keyPrefix}</TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-2">
                        {apiKey.scopes.map((scope) => (
                          <Badge key={scope} variant="outline" className="border-white/8 text-zinc-400">
                            {scope}
                          </Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-zinc-400">
                      {apiKey.lastUsedAt ? formatRelativeDate(apiKey.lastUsedAt) : "Never"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex flex-wrap items-center justify-end gap-2">
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
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
                          className="border-white/8 bg-white/[0.02] text-zinc-200 hover:bg-white/[0.05]"
                          disabled={revokeMutation.isPending}
                          onClick={() => setConfirm({ kind: "revoke", id: apiKey.id, name: apiKey.name })}
                        >
                          <Trash2 className="size-4" />
                          Revoke
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent className="border-white/10 bg-zinc-950 text-white">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm?.kind === "rotate" ? "Rotate API key?" : "Revoke API key?"}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              {confirm?.kind === "rotate" ? (
                <>
                  <span className="font-medium text-zinc-200">{confirm.name}</span> — the current secret
                  stops working immediately. You will get one chance to copy the new key.
                </>
              ) : (
                <>
                  <span className="font-medium text-zinc-200">{confirm?.name}</span> — integrations using
                  this key will fail until you replace it. This cannot be undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-white/10 bg-transparent text-zinc-300 hover:bg-white/10">
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
                    toast.success("API key revoked.")
                    setConfirm(null)
                    return
                  }
                  const result = await rotateMutation.mutateAsync(confirm.id)
                  setConfirm(null)
                  setRevealKeyName(confirm.name)
                  setRevealedKey(result.rawKey)
                  setRevealOpen(true)
                  toast.success("API key rotated — copy the new secret.")
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "Request failed.")
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
          className={cn(libraryGlassSheetPanel, "text-white")}
        >
          <SheetHeader className="relative shrink-0 space-y-1 border-b border-white/[0.06] p-2 pr-11">
            <SheetClose asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                <X className="size-4" />
              </Button>
            </SheetClose>
            <SheetTitle className="font-heading text-lg font-semibold tracking-tight text-[rgba(255,255,255,0.95)]">
              New API secret
            </SheetTitle>
            <SheetDescription className="text-[13px] leading-snug text-[rgba(255,255,255,0.45)]">
              Key &quot;{revealKeyName}&quot; — store this somewhere safe. It replaces the previous value.
            </SheetDescription>
          </SheetHeader>
          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-2">
            {revealedKey ? (
              <ApiKeyRawKeyBanner
                rawKey={revealedKey}
                title="New key"
                hint="Copy now — the old secret no longer works."
              />
            ) : null}
          </div>
          <SheetFooter className="shrink-0 border-t border-white/[0.06] p-2">
            <Button
              type="button"
              className="h-10 w-full bg-primary text-white hover:bg-primary/90"
              onClick={() => handleRevealClose(false)}
            >
              Done
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

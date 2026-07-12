"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { Eraser, Loader2 } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { clearInstanceData } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"

const CONFIRM_PHRASE = "CLEAR INSTANCE DATA"

export function ClearDataPanel() {
  const queryClient = useQueryClient()
  const [clearMedia, setClearMedia] = useState(true)
  const [clearChat, setClearChat] = useState(true)
  const [clearAppData, setClearAppData] = useState(false)
  const [password, setPassword] = useState("")
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")

  const mutation = useMutation({
    mutationFn: () =>
      clearInstanceData({
        password,
        clearChat,
        clearMedia,
        clearAppData,
      }),
    onSuccess: async () => {
      toast.success("Selected data was cleared.", {
        description: "This cannot be undone. Everything else on this instance is untouched.",
      })
      setPassword("")
      setConfirmText("")
      setConfirmOpen(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.libraries }),
        queryClient.invalidateQueries({ queryKey: ["assets"] }),
        queryClient.invalidateQueries({ queryKey: ["folders"] }),
        queryClient.invalidateQueries({ queryKey: ["activity"] }),
        queryClient.invalidateQueries({ queryKey: queryKeys.uploads }),
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs }),
        queryClient.invalidateQueries({ queryKey: queryKeys.storageSettings }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chatConversations }),
        queryClient.invalidateQueries({ queryKey: queryKeys.chatContext }),
        queryClient.invalidateQueries({ queryKey: queryKeys.appDatabases }),
      ])
    },
    onError: (e: Error) => {
      toast.error("Could not clear data", { description: e.message || "Try again in a moment." })
    },
  })

  const canOpenConfirm =
    password.length > 0 && (clearMedia || clearChat || clearAppData) && !mutation.isPending

  return (
    <div className="space-y-6">
      <Card className="border-amber-200/80 bg-amber-50/40 shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="flex items-center gap-2 text-base font-semibold text-zinc-900">
            <Eraser className="size-4 text-amber-700" />
            Reset instance content
          </CardTitle>
          <CardDescription className="text-zinc-600">
            Remove uploads, library folders, chat history, jobs, and the activity feed from this instance. Users,
            libraries, storage locations, and API keys are kept. Requires your account password.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3 rounded-xl border border-border bg-card/80 p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-zinc-500">What to clear</p>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={clearMedia}
                onCheckedChange={(v) => setClearMedia(v === true)}
                className="mt-0.5"
                aria-label="Clear media and uploads"
              />
              <span>
                <span className="text-sm font-medium text-foreground">Media &amp; libraries</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  All assets, folders, upload sessions, storage objects, tags, background jobs, and activity events.
                  Files under your storage root are removed when safe paths match.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={clearChat}
                onCheckedChange={(v) => setClearChat(v === true)}
                className="mt-0.5"
                aria-label="Clear chat"
              />
              <span>
                <span className="text-sm font-medium text-foreground">Chat</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  All conversations and messages for every user on this instance.
                </span>
              </span>
            </label>
            <label className="flex cursor-pointer items-start gap-3">
              <Checkbox
                checked={clearAppData}
                onCheckedChange={(v) => setClearAppData(v === true)}
                className="mt-0.5"
                aria-label="Clear app databases"
              />
              <span>
                <span className="text-sm font-medium text-foreground">App Data databases</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  Custom databases created under App Data (folders and records), not library file storage.
                </span>
              </span>
            </label>
          </div>

          <Field>
            <FieldLabel htmlFor="clear-data-password">Your password</FieldLabel>
            <Input
              id="clear-data-password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Confirm you are allowed to do this"
              className="max-w-md"
            />
          </Field>

          <Button
            type="button"
            variant="destructive"
            disabled={!canOpenConfirm}
            onClick={() => {
              setConfirmText("")
              setConfirmOpen(true)
            }}
          >
            Clear selected data…
          </Button>
        </CardContent>
      </Card>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear instance data?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2 text-left">
              <span className="block">
                This cannot be undone. Type{" "}
                <span className="rounded bg-muted px-1 font-mono text-xs text-foreground">{CONFIRM_PHRASE}</span>{" "}
                exactly, then confirm.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="clear-data-confirm" className="text-xs text-muted-foreground">
              Confirmation phrase
            </Label>
            <Input
              id="clear-data-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              placeholder={CONFIRM_PHRASE}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel type="button">Cancel</AlertDialogCancel>
            <Button
              type="button"
              variant="destructive"
              disabled={confirmText !== CONFIRM_PHRASE || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  Clearing…
                </>
              ) : (
                "Clear now"
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

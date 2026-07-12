"use client"

import { useRef, useState } from "react"
import { Copy, RefreshCw, X } from "lucide-react"

import { API_KEY_SCOPES } from "@arciin/shared"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { ApiKeyRevealPanel } from "@/components/settings/api-key-reveal-panel"
import { ScrollFadeHint } from "@/components/settings/scroll-fade-hint"
import {
  API_KEY_ADMIN_SCOPE,
  isAdminScopeSet,
  scopesForApiKeySubmit,
} from "@/lib/api-keys/scope-display"
import { createApiKey } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { notifyApiKey, notifyApiKeyError } from "@/lib/notifications/toast-actions"
import { copyTextNow } from "@/lib/utils/clipboard"
import { cn } from "@/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"

const ADJ = ["fast", "secure", "silent", "remote", "global", "local", "private", "direct", "smart", "live", "sharp", "clean"]
const NOUN = ["token", "agent", "runner", "hook", "client", "bridge", "relay", "probe", "sync", "worker", "pipe", "key"]
const REGULAR_SCOPES = API_KEY_SCOPES.filter((scope) => scope !== API_KEY_ADMIN_SCOPE)

function generateKeyName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${NOUN[Math.floor(Math.random() * NOUN.length)]}`
}

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => generateKeyName())
  const [scopes, setScopes] = useState<string[]>(["assets:read"])
  const [rawKey, setRawKey] = useState<string | null>(null)
  const [createdKeyName, setCreatedKeyName] = useState<string | null>(null)
  const [createdScopes, setCreatedScopes] = useState<string[]>([])
  const copyFieldRef = useRef<HTMLInputElement>(null)
  const queryClient = useQueryClient()
  const isAdmin = isAdminScopeSet(scopes)
  const keyRevealed = Boolean(rawKey)

  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys,
      })
    },
  })

  const resetForm = () => {
    setRawKey(null)
    setCreatedKeyName(null)
    setCreatedScopes([])
    setName(generateKeyName())
    setScopes(["assets:read"])
  }

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setName(generateKeyName())
    } else {
      resetForm()
    }
  }

  const handleAdminChange = (checked: boolean) => {
    if (checked) {
      setScopes([...API_KEY_SCOPES])
      return
    }
    setScopes(["assets:read"])
  }

  const handleRegularScopeChange = (scope: string, checked: boolean) => {
    if (isAdmin) {
      return
    }
    setScopes((current) =>
      checked ? [...current, scope] : current.filter((value) => value !== scope),
    )
  }

  const handleCopyKey = () => {
    if (!rawKey) {
      return
    }
    const ok = copyTextNow(rawKey, copyFieldRef.current)
    if (ok) {
      notifyApiKey("copied")
    } else {
      notifyApiKeyError("Click the key field, press Ctrl+A, then Ctrl+C (or Cmd+C).")
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button className="bg-primary text-white hover:bg-primary/90">
          Create API key
        </Button>
      </SheetTrigger>

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
            {keyRevealed ? "Copy your API key" : "Create API key"}
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            {keyRevealed
              ? `Key "${createdKeyName ?? "created"}" is ready. Copy it now — Arciin will not show the full secret again.`
              : "Generate a scoped key for automations, uploads, and developer tooling."}
          </SheetDescription>
        </SheetHeader>

        {keyRevealed ? (
          <div className="flex min-h-0 flex-1 flex-col px-5 py-5">
            <ApiKeyRevealPanel
              rawKey={rawKey!}
              keyName={createdKeyName ?? "API key"}
              scopes={createdScopes}
              copyFieldRef={copyFieldRef}
            />
          </div>
        ) : (
          <div className="flex min-h-0 flex-1 flex-col gap-5 px-5 py-5">
            <Field className="shrink-0">
              <FieldLabel
                htmlFor="apiKeyName"
                className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                Name
              </FieldLabel>
              <div className="flex items-center gap-2">
                <Input
                  id="apiKeyName"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="e.g. fast-token"
                  className="flex-1"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon-sm"
                  className="shrink-0 border-border text-muted-foreground hover:text-foreground"
                  onClick={() => setName(generateKeyName())}
                  aria-label="Generate new name"
                >
                  <RefreshCw className="size-3.5" />
                </Button>
              </div>
              <FieldError errors={[!name.trim() ? { message: "Name is required." } : undefined]} />
            </Field>

            <FieldSet className="flex min-h-0 flex-1 flex-col gap-3">
              <div className="shrink-0">
                <FieldTitle className="text-[13px] font-medium text-foreground">
                  Scopes
                </FieldTitle>
                <FieldDescription className="text-[12px] text-muted-foreground">
                  Choose permissions now. The secret is shown on the next step after you create the key.
                </FieldDescription>
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-3 pt-1">
                <div className="shrink-0 border-b border-border pb-3">
                  <p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Administration
                  </p>
                  <label
                    className={cn(
                      "flex cursor-pointer items-start gap-3 rounded-xl border p-3 text-sm transition-colors",
                      isAdmin
                        ? "border-primary/35 bg-primary/5 hover:bg-primary/10"
                        : "border-border bg-muted/40 hover:bg-muted/60",
                    )}
                  >
                    <Checkbox checked={isAdmin} onCheckedChange={(checked) => handleAdminChange(checked === true)} />
                    <FieldContent className="gap-0.5">
                      <span className="font-medium text-foreground">{API_KEY_ADMIN_SCOPE}</span>
                      <span className="text-[12px] text-muted-foreground">
                        Full access — selects every scoped permission below.
                      </span>
                    </FieldContent>
                  </label>
                </div>

                <div className="flex min-h-0 flex-1 flex-col">
                  <p className="mb-2 shrink-0 text-[10px] font-bold uppercase tracking-wider text-zinc-500">
                    Scoped permissions
                  </p>
                  <ScrollFadeHint>
                    <div className="grid gap-2">
                      {REGULAR_SCOPES.map((scope) => (
                        <label
                          key={scope}
                          className={cn(
                            "flex items-start gap-3 rounded-xl border border-border bg-muted/40 p-3 text-sm transition-colors",
                            isAdmin ? "cursor-default opacity-70" : "cursor-pointer hover:bg-muted/60",
                          )}
                        >
                          <Checkbox
                            checked={scopes.includes(scope)}
                            disabled={isAdmin}
                            onCheckedChange={(checked) => handleRegularScopeChange(scope, checked === true)}
                          />
                          <FieldContent>
                            <span className="font-medium text-foreground">{scope}</span>
                          </FieldContent>
                        </label>
                      ))}
                    </div>
                  </ScrollFadeHint>
                </div>
              </div>
            </FieldSet>
          </div>
        )}

        <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
          {keyRevealed ? (
            <div className="flex w-full flex-col gap-2">
              <Button
                type="button"
                className="h-10 w-full bg-primary text-white hover:bg-primary/90"
                onMouseDown={(event) => {
                  event.preventDefault()
                  handleCopyKey()
                }}
              >
                <Copy className="size-4" />
                Copy key
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full border-border"
                onClick={() => handleOpenChange(false)}
              >
                Done
              </Button>
            </div>
          ) : (
            <Button
              className="h-10 w-full bg-primary text-white hover:bg-primary/90"
              disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
              onClick={() => {
                const trimmedName = name.trim()
                const submittedScopes = scopesForApiKeySubmit(scopes)
                void createMutation
                  .mutateAsync({
                    name: trimmedName,
                    scopes: submittedScopes,
                  })
                  .then((result) => {
                    setRawKey(result.rawKey)
                    setCreatedKeyName(trimmedName)
                    setCreatedScopes(submittedScopes)
                    notifyApiKey("created", { name: trimmedName })
                  })
                  .catch((error: unknown) => {
                    notifyApiKeyError(error instanceof Error ? error.message : "Could not create API key.")
                  })
              }}
            >
              {createMutation.isPending ? "Creating…" : "Create key"}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

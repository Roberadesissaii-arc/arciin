"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { toast } from "sonner"

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
import { ApiKeyRawKeyBanner } from "@/components/settings/api-key-raw-key-banner"
import { createApiKey } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"
import { useMutation, useQueryClient } from "@tanstack/react-query"

const glassInput =
  "h-10 border-white/[0.08] bg-white/[0.04] text-[rgba(255,255,255,0.95)] placeholder:text-[rgba(255,255,255,0.35)] backdrop-blur-sm focus-visible:ring-white/20"

const labelCaps =
  "text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]"

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [scopes, setScopes] = useState<string[]>(["assets:read"])
  const [rawKey, setRawKey] = useState<string | null>(null)
  const queryClient = useQueryClient()
  const createMutation = useMutation({
    mutationFn: createApiKey,
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: queryKeys.apiKeys,
      })
    },
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      setRawKey(null)
      setName("")
      setScopes(["assets:read"])
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
            Create API key
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-[rgba(255,255,255,0.45)]">
            Generate a scoped key for automations, uploads, and developer tooling.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-2">
          <Field>
            <FieldLabel htmlFor="apiKeyName" className={labelCaps}>
              Name
            </FieldLabel>
            <Input
              id="apiKeyName"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={glassInput}
            />
            <FieldError errors={[!name.trim() ? { message: "Name is required." } : undefined]} />
          </Field>

          <FieldSet className="gap-3">
            <FieldTitle className={cn("text-sm font-medium text-[rgba(255,255,255,0.92)]")}>
              Scopes
            </FieldTitle>
            <FieldDescription className="text-[13px] text-[rgba(255,255,255,0.45)]">
              Only the raw key is shown once after creation.
            </FieldDescription>
            <div className="grid gap-2 pt-1">
              {API_KEY_SCOPES.map((scope: (typeof API_KEY_SCOPES)[number]) => (
                <label
                  key={scope}
                  className="flex items-start gap-3 rounded-xl border border-white/[0.08] bg-white/[0.04] p-3 text-sm backdrop-blur-sm"
                >
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={(checked) => {
                      setScopes((current) =>
                        checked ? [...current, scope] : current.filter((value) => value !== scope)
                      )
                    }}
                  />
                  <FieldContent>
                    <span className="font-medium text-[rgba(255,255,255,0.95)]">{scope}</span>
                  </FieldContent>
                </label>
              ))}
            </div>
          </FieldSet>

          {rawKey ? <ApiKeyRawKeyBanner rawKey={rawKey} /> : null}
        </div>

        <SheetFooter className="shrink-0 border-t border-white/[0.06] p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={createMutation.isPending || !name.trim() || scopes.length === 0}
            onClick={async () => {
              try {
                const result = await createMutation.mutateAsync({
                  name: name.trim(),
                  scopes,
                })
                setRawKey(result.rawKey)
                toast.success("API key created.")
                setName("")
                setScopes(["assets:read"])
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create API key.")
              }
            }}
          >
            {createMutation.isPending ? "Creating…" : "Create key"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

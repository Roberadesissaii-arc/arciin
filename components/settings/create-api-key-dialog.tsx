"use client"

import { useState } from "react"
import { RefreshCw, X } from "lucide-react"
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

const ADJ  = ["fast","secure","silent","remote","global","local","private","direct","smart","live","sharp","clean"]
const NOUN = ["token","agent","runner","hook","client","bridge","relay","probe","sync","worker","pipe","key"]
function generateKeyName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${NOUN[Math.floor(Math.random() * NOUN.length)]}`
}

export function CreateApiKeyDialog() {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => generateKeyName())
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
    onError: (e: Error) => toast.error(e.message || "Could not create API key."),
  })

  const handleOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) {
      setName(generateKeyName())
    } else {
      setRawKey(null)
      setName(generateKeyName())
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
        className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
      >
        {/* Header */}
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
            Create API key
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            Generate a scoped key for automations, uploads, and developer tooling.
          </SheetDescription>
        </SheetHeader>

        {/* Body */}
        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <Field>
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

          <FieldSet className="gap-3">
            <FieldTitle className="text-[13px] font-medium text-foreground">
              Scopes
            </FieldTitle>
            <FieldDescription className="text-[12px] text-muted-foreground">
              Only the raw key is shown once after creation.
            </FieldDescription>
            <div className="grid gap-2 pt-1">
              {API_KEY_SCOPES.map((scope: (typeof API_KEY_SCOPES)[number]) => (
                <label
                  key={scope}
                  className="flex cursor-pointer items-start gap-3 rounded-xl border border-border bg-muted/40 p-3 text-sm transition-colors hover:bg-muted/60"
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
                    <span className="font-medium text-foreground">{scope}</span>
                  </FieldContent>
                </label>
              ))}
            </div>
          </FieldSet>

          {rawKey ? <ApiKeyRawKeyBanner rawKey={rawKey} /> : null}
        </div>

        {/* Footer */}
        <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
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

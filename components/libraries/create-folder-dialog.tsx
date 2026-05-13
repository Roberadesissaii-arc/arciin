"use client"

import { useState } from "react"
import { FolderPlus, X } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
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
import { useCreateFolder } from "@/hooks/use-libraries"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"

const glassInput =
  "h-10 border-white/[0.08] bg-white/[0.04] text-[rgba(255,255,255,0.95)] placeholder:text-[rgba(255,255,255,0.35)] backdrop-blur-sm focus-visible:ring-white/20"

export function CreateFolderDialog({
  libraryId,
  parentFolderId,
}: {
  libraryId: string
  parentFolderId?: string
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState("")
  const [error, setError] = useState<string | undefined>()
  const createFolderMutation = useCreateFolder()

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button className="bg-primary text-white hover:bg-primary/90">
          <FolderPlus className="size-4" />
          Create folder
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
            Create folder
          </SheetTitle>
          <SheetDescription className="text-[13px] leading-snug text-[rgba(255,255,255,0.45)]">
            Add a nested folder inside this library to keep the archive organized.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col overflow-y-auto p-2">
          <Field>
            <FieldLabel
              htmlFor="folderName"
              className="text-[11px] font-semibold uppercase tracking-wider text-[rgba(255,255,255,0.3)]"
            >
              Folder name
            </FieldLabel>
            <Input
              id="folderName"
              value={name}
              onChange={(event) => {
                setName(event.target.value)
                setError(undefined)
              }}
              className={glassInput}
            />
            <FieldError errors={[error ? { message: error } : undefined]} />
          </Field>
        </div>

        <SheetFooter className="shrink-0 border-t border-white/[0.06] p-2">
          <Button
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            disabled={createFolderMutation.isPending}
            onClick={async () => {
              if (!name.trim()) {
                setError("Folder name is required.")
                return
              }

              try {
                await createFolderMutation.mutateAsync({
                  libraryId,
                  parentFolderId,
                  name: name.trim(),
                })
                toast.success("Folder created.")
                setName("")
                setOpen(false)
              } catch (submitError) {
                toast.error(
                  submitError instanceof Error
                    ? submitError.message
                    : "Could not create folder."
                )
              }
            }}
          >
            {createFolderMutation.isPending ? "Creating…" : "Create folder"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

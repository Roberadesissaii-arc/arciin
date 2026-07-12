"use client"

import { Plus, RefreshCw, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
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
import { generateDatabaseName } from "@/lib/database/app-database-list"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"

type MutationLike = {
  isPending: boolean
  mutate: () => void
}

export function CreateAppDatabaseSheet({
  open,
  setOpen,
  name,
  setName,
  description,
  setDescription,
  createMutation,
}: {
  open: boolean
  setOpen: (open: boolean) => void
  name: string
  setName: (v: string) => void
  description: string
  setDescription: (v: string) => void
  createMutation: MutationLike
}) {
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) { setName(generateDatabaseName()); setDescription("") }
      }}
    >
      <SheetTrigger asChild>
        <Button size="sm" className="gap-1.5 bg-primary text-white hover:bg-primary/90">
          <Plus className="size-4" />
          New database
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
            New app data database
          </SheetTitle>
          <SheetDescription className="text-[13px] text-muted-foreground">
            A Default table is created in Postgres so you can add rows immediately.
          </SheetDescription>
        </SheetHeader>

        <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
          <div className="space-y-1.5">
            <Label htmlFor="adb-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Name
            </Label>
            <div className="flex items-center gap-2">
              <Input
                id="adb-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. ecommerce"
                autoComplete="off"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                className="shrink-0"
                title="Generate name"
                onClick={() => setName(generateDatabaseName())}
              >
                <RefreshCw className="size-3.5" />
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">e.g. ecommerce — auto-generated, you can edit it.</p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="adb-desc" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              Description <span className="normal-case font-normal">(optional)</span>
            </Label>
            <Input
              id="adb-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this store is for"
              autoComplete="off"
            />
          </div>
        </div>

        <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
          <Button
            type="button"
            className="h-10 w-full bg-primary text-white hover:bg-primary/90"
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending || !name.trim()}
          >
            {createMutation.isPending ? "Creating…" : "Create database"}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

"use client"

import { ChevronDown, ChevronRight, Loader2, Plus, Table2, Trash2, X } from "lucide-react"

import { Badge } from "@/components/ui/badge"
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
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { approxTableSizeBytes, typeBadgeClass } from "@/lib/database/table-format"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { AppDatabaseFolderSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

type MutationLike<TVariables = void> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

export function AppDatabaseTablesPanel({
  foldersLoading,
  sortedFolders,
  effectiveTableId,
  canMutate,
  tableSheetOpen,
  setTableSheetOpen,
  tableName,
  setTableName,
  createFolderMutation,
  deleteFolderMutation,
  setOpenTableId,
  setPreviewRecordId,
  openAddRowSheet,
}: {
  foldersLoading: boolean
  sortedFolders: AppDatabaseFolderSummary[]
  effectiveTableId: string | null
  canMutate: boolean
  tableSheetOpen: boolean
  setTableSheetOpen: (open: boolean) => void
  tableName: string
  setTableName: (name: string) => void
  createFolderMutation: MutationLike
  deleteFolderMutation: MutationLike<string>
  setOpenTableId: (id: string | null) => void
  setPreviewRecordId: (id: string | null) => void
  openAddRowSheet: (tableId: string) => void
}) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">Tables</h2>
        {canMutate ? (
          <Sheet open={tableSheetOpen} onOpenChange={(next) => { setTableSheetOpen(next); if (!next) setTableName("") }}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="gap-1 border-border bg-card text-foreground hover:bg-muted/50">
                <Table2 className="size-4" />
                Add table
              </Button>
            </SheetTrigger>
            <SheetContent side="right" showCloseButton={false} className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}>
              <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
                <SheetClose asChild>
                  <Button type="button" variant="ghost" size="icon-sm" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground" aria-label="Close">
                    <X className="size-4" />
                  </Button>
                </SheetClose>
                <SheetTitle className="text-[15px] font-semibold text-foreground">New table</SheetTitle>
                <SheetDescription className="text-[13px] text-muted-foreground">
                  Tables group rows in this database. Add columns after creating the table.
                </SheetDescription>
              </SheetHeader>
              <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
                <div className="space-y-1.5">
                  <Label htmlFor="table-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Table name</Label>
                  <Input id="table-name" value={tableName} onChange={(e) => setTableName(e.target.value)} placeholder="e.g. orders" />
                </div>
              </div>
              <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
                <Button type="button" className="h-10 w-full bg-primary text-white hover:bg-primary/90" disabled={!tableName.trim() || createFolderMutation.isPending} onClick={() => createFolderMutation.mutate()}>
                  {createFolderMutation.isPending ? "Creating…" : "Create table"}
                </Button>
              </SheetFooter>
            </SheetContent>
          </Sheet>
        ) : null}
      </div>

      {foldersLoading ? (
        <Empty className="rounded-2xl border border-dashed border-border bg-muted/10 py-14">
          <EmptyHeader><EmptyMedia variant="icon"><Loader2 className="size-4 animate-spin text-primary" /></EmptyMedia><EmptyTitle>Loading tables</EmptyTitle><EmptyDescription>Fetching table metadata.</EmptyDescription></EmptyHeader>
        </Empty>
      ) : !sortedFolders.length ? (
        <div className="rounded-2xl border border-dashed border-border p-6 text-sm text-muted-foreground">
          No tables yet. Use &quot;Add table&quot; above — new databases include a &quot;Default&quot; table automatically.
        </div>
      ) : (
        <div className="min-w-0 max-w-full overflow-x-auto rounded-3xl border border-border bg-card p-3">
          <Table className="w-full min-w-[640px]">
            <TableHeader>
              <TableRow className="border-border hover:bg-transparent">
                <TableHead className="text-left font-semibold text-muted-foreground">Name</TableHead>
                <TableHead className="text-left font-semibold text-muted-foreground">Type</TableHead>
                <TableHead className="text-left font-semibold text-muted-foreground">Size</TableHead>
                <TableHead className="text-left font-semibold text-muted-foreground">Created</TableHead>
                <TableHead className="text-right font-semibold text-muted-foreground">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedFolders.map((f) => {
                const isOpen = effectiveTableId === f.id
                return (
                  <TableRow key={f.id} className={cn("border-border hover:bg-muted/30 [&>td]:align-middle [&>td]:py-2.5", isOpen && "bg-primary/[0.05]")}>
                    <TableCell className="max-w-0 py-2.5">
                      <div className="flex items-center gap-1.5">
                        {isOpen ? <ChevronDown className="size-3.5 shrink-0 text-primary" /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />}
                        <span className="block truncate font-medium text-foreground" title={f.pathCache}>{f.name}</span>
                      </div>
                      <span className="mt-0.5 block pl-5 text-[11px] text-muted-foreground">{f.recordCount} row{f.recordCount === 1 ? "" : "s"}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge className={cn("inline-flex h-7 min-w-[5.75rem] shrink-0 justify-center rounded-md px-2.5 tabular-nums", typeBadgeClass)}>TABLE</Badge>
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground">{formatBytes(approxTableSizeBytes(f))}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground"><RelativeTime value={f.createdAt} /></TableCell>
                    <TableCell className="whitespace-nowrap text-right">
                      <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                        <Button type="button" variant="outline" size="sm"
                          className={cn("border-border bg-card text-foreground hover:bg-muted/50", isOpen && "border-primary/30 bg-primary/10 text-primary hover:bg-primary/15")}
                          onClick={() => { setOpenTableId(isOpen ? null : f.id); setPreviewRecordId(null) }}>
                          {isOpen ? "Close" : "Open"}
                        </Button>
                        {canMutate ? (
                          <>
                            <Button type="button" size="sm" variant="outline" className="gap-1 border-border bg-card text-foreground hover:bg-muted/50" onClick={() => openAddRowSheet(f.id)}>
                              <Plus className="size-3.5" />
                              Add row
                            </Button>
                            <Button type="button" variant="default" size="sm" className="border-0 bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
                              disabled={deleteFolderMutation.isPending}
                              onClick={() => { if (window.confirm(`Delete table "${f.pathCache}" and all its rows?`)) deleteFolderMutation.mutate(f.id) }}>
                              <Trash2 className="size-4" />
                              Delete
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

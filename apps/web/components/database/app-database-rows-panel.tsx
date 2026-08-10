"use client"

import type { Dispatch, SetStateAction } from "react"
import { Database, Loader2, RefreshCw, Trash2, X } from "lucide-react"

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
} from "@/components/ui/sheet"
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { columnInputType, type ColumnDef } from "@/lib/database/column-schema"
import { recordPayloadBytes, recordRowKind, typeBadgeClass } from "@/lib/database/table-format"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { cn } from "@/lib/utils"
import type { AppDatabaseRecordSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

type MutationLike<TVariables = void> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

export function AppDatabaseRowsPanel({
  tableName,
  recordsQuery,
  previewRecordId,
  setPreviewRecordId,
  previewRecord,
  canMutate,
  deleteRecordMutation,
  onRefresh,
  rowSheetOpen,
  onRowSheetOpenChange,
  columns,
  rowKey,
  setRowKey,
  rowValues,
  setRowValues,
  rowRawBody,
  setRowRawBody,
  createRecordMutation,
}: {
  tableName: string
  recordsQuery: {
    isError: boolean
    isLoading: boolean
    data: AppDatabaseRecordSummary[] | undefined
  }
  previewRecordId: string | null
  setPreviewRecordId: Dispatch<SetStateAction<string | null>>
  previewRecord: AppDatabaseRecordSummary | null
  canMutate: boolean
  deleteRecordMutation: MutationLike<string>
  onRefresh: () => void
  rowSheetOpen: boolean
  onRowSheetOpenChange: (open: boolean) => void
  columns: ColumnDef[]
  rowKey: string
  setRowKey: (v: string) => void
  rowValues: Record<string, string>
  setRowValues: Dispatch<SetStateAction<Record<string, string>>>
  rowRawBody: string
  setRowRawBody: (v: string) => void
  createRecordMutation: MutationLike
}) {
  return (
    <>
      {/* Rows */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-foreground">
              Rows — <span className="text-primary">{tableName}</span>
            </h2>
            <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground"
              onClick={onRefresh} title="Refresh">
              <RefreshCw className="size-3.5" />
            </Button>
          </div>
        </div>

        {recordsQuery.isError ? (
          <Empty className="rounded-2xl border border-red-500/20 bg-red-500/[0.06] py-14">
            <EmptyHeader><EmptyMedia variant="icon"><Database className="size-4 text-red-600" /></EmptyMedia><EmptyTitle>Could not load rows</EmptyTitle><EmptyDescription>Check that the API is running.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : recordsQuery.isLoading ? (
          <Empty className="rounded-2xl border border-dashed border-border bg-muted/10 py-14">
            <EmptyHeader><EmptyMedia variant="icon"><Loader2 className="size-4 animate-spin text-primary" /></EmptyMedia><EmptyTitle>Loading rows</EmptyTitle><EmptyDescription>Fetching JSON rows for this table.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : !(recordsQuery.data ?? []).length ? (
          <Empty className="rounded-2xl border border-dashed border-border bg-muted/5 py-14">
            <EmptyHeader><EmptyMedia variant="icon"><Database className="size-4 text-muted-foreground" /></EmptyMedia><EmptyTitle>No rows in this table</EmptyTitle><EmptyDescription>Use &quot;Add row&quot; in the table actions above.</EmptyDescription></EmptyHeader>
          </Empty>
        ) : (
          <>
            <div className="min-w-0 max-w-full overflow-x-auto rounded-3xl border border-border bg-card p-3">
              <Table className="w-full min-w-[600px]">
                <TableHeader>
                  <TableRow className="border-border hover:bg-transparent">
                    <TableHead className="text-left font-semibold text-muted-foreground">Key</TableHead>
                    <TableHead className="text-left font-semibold text-muted-foreground">Type</TableHead>
                    <TableHead className="text-left font-semibold text-muted-foreground">Size</TableHead>
                    <TableHead className="text-left font-semibold text-muted-foreground">Created</TableHead>
                    <TableHead className="text-right font-semibold text-muted-foreground">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(recordsQuery.data ?? []).map((r) => (
                    <TableRow key={r.id} className={cn("border-border hover:bg-muted/30 [&>td]:align-middle [&>td]:py-2.5", previewRecordId === r.id && "bg-primary/[0.05]")}>
                      <TableCell className="max-w-0 py-2.5">
                        <span className="block w-full truncate font-medium text-foreground" title={r.name}>{r.name}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge className={cn("inline-flex h-7 min-w-[5.75rem] shrink-0 justify-center rounded-md px-2.5 tabular-nums", typeBadgeClass)}>
                          {recordRowKind(r)}
                        </Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground">{formatBytes(recordPayloadBytes(r))}</TableCell>
                      <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground"><RelativeTime value={r.createdAt} /></TableCell>
                      <TableCell className="whitespace-nowrap text-right">
                        <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                          <Button type="button" variant="outline" size="sm"
                            className={cn("border-border bg-card text-foreground hover:bg-muted/50", previewRecordId === r.id && "border-primary/30 bg-primary/10 text-primary")}
                            onClick={() => setPreviewRecordId((cur) => (cur === r.id ? null : r.id))}>
                            {previewRecordId === r.id ? "Hide" : "Open"}
                          </Button>
                          {canMutate ? (
                            <Button type="button" variant="default" size="sm" className="border-0 bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626]"
                              disabled={deleteRecordMutation.isPending}
                              onClick={() => { if (window.confirm(`Delete row "${r.name}"?`)) deleteRecordMutation.mutate(r.id) }}>
                              <Trash2 className="size-4" />
                              Delete
                            </Button>
                          ) : null}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {previewRecord ? (
              <div className="rounded-2xl border border-border bg-muted/20 p-4">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{previewRecord.name}</p>
                  <Button type="button" variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setPreviewRecordId(null)}>Close</Button>
                </div>
                <pre className="max-h-72 overflow-auto rounded-xl border border-border bg-zinc-950 p-4 font-mono text-[11px] leading-relaxed text-zinc-100">
                  {JSON.stringify(previewRecord.payload, null, 2)}
                </pre>
              </div>
            ) : null}
          </>
        )}
      </div>

      {/* ── Add row sheet ──────────────────────────────────────────────────── */}
      <Sheet open={rowSheetOpen} onOpenChange={onRowSheetOpenChange}>
        <SheetContent side="right" showCloseButton={false} className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}>
          <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </Button>
            </SheetClose>
            <SheetTitle className="text-[15px] font-semibold text-foreground">New row</SheetTitle>
            <SheetDescription className="text-[13px] text-muted-foreground">
              {columns.length > 0
                ? `A row is one entry in this table. Fill in the ${columns.length} field${columns.length === 1 ? "" : "s"} below.`
                : "A row is one entry in this table — like one line in a spreadsheet. Give it a name and save whatever you want below."}
            </SheetDescription>
          </SheetHeader>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {/* Row key — always present */}
            <div className="space-y-1.5">
              <Label htmlFor="row-key" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Name this entry <span className="normal-case font-normal text-muted-foreground">(optional — we&apos;ll generate one if left blank)</span>
              </Label>
              <Input id="row-key" value={rowKey} onChange={(e) => setRowKey(e.target.value)} placeholder="e.g. order-1042 or leave blank" autoComplete="off" />
            </div>

            {columns.length > 0 ? (
              /* Typed column inputs */
              columns.map((col) => {
                const inputType = columnInputType(col.type)
                const isJson = col.type === "json" || col.type === "jsonb"
                return (
                  <div key={col.id} className="space-y-1.5">
                    <Label htmlFor={`col-${col.id}`} className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      {col.name}
                      <span className="rounded bg-muted/60 px-1 py-0.5 font-mono text-[9px] normal-case font-normal">{col.type}</span>
                      {col.isPrimary && <span className="rounded bg-primary/10 px-1 py-0.5 text-[9px] text-primary normal-case">PK</span>}
                    </Label>
                    {inputType === "checkbox" ? (
                      <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                        <input
                          type="checkbox"
                          id={`col-${col.id}`}
                          checked={rowValues[col.name] === "true"}
                          onChange={(e) => setRowValues((v) => ({ ...v, [col.name]: e.target.checked ? "true" : "false" }))}
                          className="accent-primary"
                        />
                        <span className="text-[13px] text-foreground">{rowValues[col.name] === "true" ? "true" : "false"}</span>
                      </label>
                    ) : isJson ? (
                      <textarea
                        id={`col-${col.id}`}
                        className="min-h-[100px] w-full rounded-xl border border-input bg-background px-3 py-2 font-mono text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                        value={rowValues[col.name] ?? col.defaultValue}
                        onChange={(e) => setRowValues((v) => ({ ...v, [col.name]: e.target.value }))}
                        placeholder={`{"key": "value"}`}
                      />
                    ) : (
                      <Input
                        id={`col-${col.id}`}
                        type={inputType}
                        value={rowValues[col.name] ?? col.defaultValue}
                        onChange={(e) => setRowValues((v) => ({ ...v, [col.name]: e.target.value }))}
                        placeholder={col.defaultValue || col.nullable ? "NULL" : "required"}
                      />
                    )}
                  </div>
                )
              })
            ) : (
              /* Fallback: raw JSON */
              <div className="space-y-1.5">
                <Label htmlFor="row-body" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                  What do you want to save? <span className="normal-case font-normal">(optional)</span>
                </Label>
                <textarea
                  id="row-body"
                  className="min-h-[140px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  value={rowRawBody}
                  onChange={(e) => setRowRawBody(e.target.value)}
                  placeholder="Type anything — a note, a name, some text…"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  Plain text is fine — it&apos;ll be saved as-is. You can leave this empty too. If you have
                  structured data, you can paste JSON instead, e.g.{" "}
                  <code className="rounded bg-muted px-1">{'{"total": 42}'}</code>.
                </p>
              </div>
            )}
          </div>

          <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
            <Button type="button" className="h-10 w-full bg-primary text-white hover:bg-primary/90"
              disabled={createRecordMutation.isPending}
              onClick={() => createRecordMutation.mutate()}>
              {createRecordMutation.isPending ? "Saving…" : "Save row"}
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </>
  )
}

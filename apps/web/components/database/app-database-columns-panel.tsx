"use client"

import { Columns3, Plus, X } from "lucide-react"

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
import { TypePicker } from "@/components/database/type-picker"
import type { ColumnDef } from "@/lib/database/column-schema"
import { PG_TYPES } from "@/lib/database/pg-types"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { cn } from "@/lib/utils"

export function AppDatabaseColumnsPanel({
  tableName,
  columns,
  canMutate,
  colSheetOpen,
  setColSheetOpen,
  colName,
  setColName,
  colType,
  setColType,
  colDefault,
  setColDefault,
  colNullable,
  setColNullable,
  colPrimary,
  setColPrimary,
  addColumn,
  removeColumn,
}: {
  tableName: string
  columns: ColumnDef[]
  canMutate: boolean
  colSheetOpen: boolean
  setColSheetOpen: (open: boolean) => void
  colName: string
  setColName: (v: string) => void
  colType: string
  setColType: (v: string) => void
  colDefault: string
  setColDefault: (v: string) => void
  colNullable: boolean
  setColNullable: (v: boolean) => void
  colPrimary: boolean
  setColPrimary: (v: boolean) => void
  addColumn: () => void
  removeColumn: (id: string) => void
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Columns3 className="size-3.5 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">
            Columns — <span className="text-primary">{tableName}</span>
          </h3>
        </div>
        {canMutate ? (
          <Button size="sm" variant="outline" className="gap-1 border-border bg-card text-foreground hover:bg-muted/50" onClick={() => setColSheetOpen(true)}>
            <Plus className="size-3.5" />
            Add column
          </Button>
        ) : null}
      </div>

      {columns.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
          <p>
            No columns yet — and that&apos;s fine. You can start adding rows below and just type whatever you
            want to save.
          </p>
          <p className="mt-1.5">
            Only add columns here if you want every row in this table to share the same fields — like column
            headers in a spreadsheet (e.g. <span className="font-mono text-foreground">price</span>,{" "}
            <span className="font-mono text-foreground">status</span>). Once you add one, the &quot;Add
            row&quot; form switches from a text box to fields matching your columns.
          </p>
        </div>
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-2xl border border-border bg-card p-2.5">
          <table className="w-full min-w-[520px] text-[13px]">
            <thead>
              <tr className="border-b border-border text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <th className="pb-2 pl-2 pr-3">Name</th>
                <th className="pb-2 pr-3">Type</th>
                <th className="pb-2 pr-3">Default</th>
                <th className="pb-2 pr-3">Nullable</th>
                <th className="pb-2 pr-2 text-right"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {columns.map((col) => (
                <tr key={col.id} className="group">
                  <td className="py-2 pl-2 pr-3">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono font-medium text-foreground">{col.name}</span>
                      {col.isPrimary && (
                        <span className="rounded bg-primary/10 px-1 py-0.5 text-[10px] font-bold text-primary">PK</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2 pr-3">
                    <span className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[11px] text-foreground">{col.type}</span>
                  </td>
                  <td className="py-2 pr-3 font-mono text-[12px] text-muted-foreground">
                    {col.defaultValue || <span className="italic opacity-50">NULL</span>}
                  </td>
                  <td className="py-2 pr-3 text-muted-foreground">
                    {col.nullable ? "yes" : "no"}
                  </td>
                  <td className="py-2 pr-2 text-right">
                    <button
                      type="button"
                      onClick={() => removeColumn(col.id)}
                      className="opacity-0 group-hover:opacity-100 rounded-lg p-1 text-muted-foreground transition-opacity hover:bg-muted/50 hover:text-foreground"
                      title="Remove column"
                    >
                      <X className="size-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Add column sheet ───────────────────────────────────────────────── */}
      <Sheet open={colSheetOpen} onOpenChange={(next) => { setColSheetOpen(next); if (!next) { setColName(""); setColType("text"); setColDefault(""); setColNullable(true); setColPrimary(false) } }}>
        <SheetContent side="right" showCloseButton={false} className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}>
          <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
            <SheetClose asChild>
              <Button type="button" variant="ghost" size="icon-sm" className="absolute right-4 top-4 text-muted-foreground hover:text-foreground" aria-label="Close">
                <X className="size-4" />
              </Button>
            </SheetClose>
            <SheetTitle className="text-[15px] font-semibold text-foreground">Add column</SheetTitle>
            <SheetDescription className="text-[13px] text-muted-foreground">
              A column is a field every row in <strong>{tableName}</strong> will have — like a header in a
              spreadsheet. This setup is only saved in this browser; it won&apos;t show up on another device.
            </SheetDescription>
          </SheetHeader>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="col-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Column name</Label>
              <Input id="col-name" value={colName} onChange={(e) => setColName(e.target.value)} placeholder="e.g. email" autoComplete="off" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Type <span className="normal-case font-normal">— what kind of value this field holds</span>
              </Label>
              <TypePicker value={colType} onChange={setColType} />
              <p className="text-[11px] text-muted-foreground">
                {PG_TYPES.find((t) => t.value === colType)?.label}
                {colType === "text" ? " — not sure? This one works for almost anything." : null}
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="col-default" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Default value <span className="normal-case font-normal">(optional)</span>
              </Label>
              <Input id="col-default" value={colDefault} onChange={(e) => setColDefault(e.target.value)} placeholder={colType === "timestamptz" ? "now()" : "NULL"} autoComplete="off" />
            </div>

            <div className="flex flex-col gap-3">
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                <input type="checkbox" checked={colPrimary} onChange={(e) => setColPrimary(e.target.checked)} className="accent-primary" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Primary key</p>
                  <p className="text-[11px] text-muted-foreground">
                    Use this field&apos;s value to identify each row. Most tables don&apos;t need this —
                    leave unchecked if unsure.
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                <input type="checkbox" checked={colNullable} onChange={(e) => setColNullable(e.target.checked)} className="accent-primary" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Allow empty</p>
                  <p className="text-[11px] text-muted-foreground">
                    Rows can skip this field. Uncheck to require a value every time.
                  </p>
                </div>
              </label>
            </div>
          </div>

          <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
            <Button type="button" className="h-10 w-full bg-primary text-white hover:bg-primary/90" disabled={!colName.trim()} onClick={addColumn}>
              Add column
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  )
}

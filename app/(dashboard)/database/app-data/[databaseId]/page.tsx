"use client"

import Link from "next/link"
import { useMemo, useState, use } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeft, ChevronDown, ChevronRight, Columns3, Database,
  Loader2, Plus, RefreshCw, Search, Table2, Trash2, X,
} from "lucide-react"
import { toast } from "sonner"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
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
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createAppDatabaseFolder,
  createFolderRecord,
  deleteAppDatabaseFolder,
  deleteFolderRecord,
  getAppDatabase,
  listAppDatabaseFolders,
  listFolderRecords,
} from "@/lib/api/app-databases"
import { getMe } from "@/lib/api/auth"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import type { AppDatabaseFolderSummary, AppDatabaseRecordSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

// ── Postgres type catalogue ────────────────────────────────────────────────────

type PgTypeGroup = "Numeric" | "Text" | "JSON" | "Date / Time" | "Other"

type PgTypeDef = {
  value: string
  label: string
  group: PgTypeGroup
  icon: string
}

const PG_TYPES: PgTypeDef[] = [
  { value: "int2",        label: "Signed two-byte integer",              group: "Numeric",     icon: "#" },
  { value: "int4",        label: "Signed four-byte integer",             group: "Numeric",     icon: "#" },
  { value: "int8",        label: "Signed eight-byte integer",            group: "Numeric",     icon: "#" },
  { value: "float4",      label: "Single precision floating-point (4 bytes)", group: "Numeric", icon: "#" },
  { value: "float8",      label: "Double precision floating-point (8 bytes)", group: "Numeric", icon: "#" },
  { value: "numeric",     label: "Exact numeric of selectable precision", group: "Numeric",    icon: "#" },
  { value: "json",        label: "Textual JSON data",                    group: "JSON",        icon: "{}" },
  { value: "jsonb",       label: "Binary JSON data, decomposed",         group: "JSON",        icon: "{}" },
  { value: "text",        label: "Variable-length character string",     group: "Text",        icon: "T" },
  { value: "varchar",     label: "Variable-length character string",     group: "Text",        icon: "T" },
  { value: "uuid",        label: "Universally unique identifier",        group: "Text",        icon: "T" },
  { value: "date",        label: "Calendar date (year, month, day)",     group: "Date / Time", icon: "▦" },
  { value: "time",        label: "Time of day (no time zone)",           group: "Date / Time", icon: "▦" },
  { value: "timetz",      label: "Time of day, including time zone",     group: "Date / Time", icon: "▦" },
  { value: "timestamp",   label: "Date and time (no time zone)",         group: "Date / Time", icon: "▦" },
  { value: "timestamptz", label: "Date and time, including time zone",   group: "Date / Time", icon: "▦" },
  { value: "bool",        label: "Logical boolean (true/false)",         group: "Other",       icon: "≡" },
  { value: "bytea",       label: "Variable-length binary string",        group: "Other",       icon: "≡" },
]

const PG_GROUPS = ["Numeric", "Text", "JSON", "Date / Time", "Other"] as PgTypeGroup[]

// ── Column definition type ─────────────────────────────────────────────────────

type ColumnDef = {
  id: string
  name: string
  type: string
  defaultValue: string
  nullable: boolean
  isPrimary: boolean
}

function colStorageKey(tableId: string) { return `arciin:db:cols:${tableId}` }

function loadColumns(tableId: string): ColumnDef[] {
  try {
    const raw = localStorage.getItem(colStorageKey(tableId))
    return raw ? (JSON.parse(raw) as ColumnDef[]) : []
  } catch { return [] }
}

function saveColumns(tableId: string, cols: ColumnDef[]) {
  localStorage.setItem(colStorageKey(tableId), JSON.stringify(cols))
}

// ── Type picker component ──────────────────────────────────────────────────────

function TypePicker({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return PG_TYPES.filter(
      (t) => t.value.includes(q) || t.label.toLowerCase().includes(q),
    )
  }, [search])

  const selected = PG_TYPES.find((t) => t.value === value) ?? PG_TYPES[0]

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-full items-center gap-2 rounded-xl border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted/40"
      >
        <span className="w-6 shrink-0 text-center font-mono text-[11px] font-bold text-muted-foreground">
          {selected.icon}
        </span>
        <span className="flex-1 text-left font-mono text-[13px]">{selected.value}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-border bg-[#111118] shadow-xl">
          {/* Search */}
          <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-2">
            <Search className="size-3.5 shrink-0 text-zinc-500" />
            <input
              autoFocus
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search types…"
              className="flex-1 bg-transparent text-[13px] text-zinc-200 placeholder:text-zinc-600 focus:outline-none"
            />
          </div>

          {/* Type list */}
          <div className="max-h-[280px] overflow-y-auto py-1">
            {PG_GROUPS.map((group) => {
              const items = filtered.filter((t) => t.group === group)
              if (!items.length) return null
              return (
                <div key={group}>
                  <p className="px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-zinc-500">
                    {group}
                  </p>
                  {items.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => { onChange(t.value); setOpen(false); setSearch("") }}
                      className={cn(
                        "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-white/[0.06]",
                        value === t.value && "bg-white/[0.04]",
                      )}
                    >
                      <span className="w-5 shrink-0 text-center font-mono text-[11px] font-bold text-emerald-400/80">
                        {t.icon}
                      </span>
                      <span className="font-mono text-[13px] font-semibold text-zinc-200">{t.value}</span>
                      <span className="flex-1 truncate text-[12px] text-zinc-500">{t.label}</span>
                      {value === t.value && (
                        <span className="size-1.5 shrink-0 rounded-full bg-emerald-400" />
                      )}
                    </button>
                  ))}
                </div>
              )
            })}
            {filtered.length === 0 && (
              <p className="px-3 py-4 text-center text-[12px] text-zinc-500">No types match.</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

// ── Row form helpers ───────────────────────────────────────────────────────────

function columnValueToTyped(col: ColumnDef, raw: string): unknown {
  if (raw === "" || raw === null) return col.nullable ? null : undefined
  switch (col.type) {
    case "int2": case "int4": case "int8": return parseInt(raw, 10)
    case "float4": case "float8": case "numeric": return parseFloat(raw)
    case "bool": return raw === "true" || raw === "1" || raw === "yes"
    case "json": case "jsonb":
      try { return JSON.parse(raw) } catch { return raw }
    default: return raw
  }
}

function columnInputType(type: string): string {
  switch (type) {
    case "int2": case "int4": case "int8":
    case "float4": case "float8": case "numeric": return "number"
    case "bool": return "checkbox"
    case "date": return "date"
    case "time": case "timetz": return "time"
    case "timestamp": case "timestamptz": return "datetime-local"
    default: return "text"
  }
}

// ── Existing helpers ───────────────────────────────────────────────────────────

const typeBadgeClass =
  "border-0 bg-primary text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function approxTableSizeBytes(f: AppDatabaseFolderSummary): number {
  return utf8ByteLength(JSON.stringify({ path: f.pathCache, name: f.name })) + f.recordCount * 96
}

function recordPayloadBytes(r: AppDatabaseRecordSummary): number {
  try { return utf8ByteLength(JSON.stringify(r.payload)) } catch { return 0 }
}

function recordRowKind(r: AppDatabaseRecordSummary): "JSON" | "TEXT" {
  if (r.mimeType?.startsWith("text/")) return "TEXT"
  const p = r.payload
  const keys = Object.keys(p)
  if (keys.length === 1 && keys[0] === "content" && typeof p.content === "string") return "TEXT"
  return "JSON"
}

function payloadFromRaw(text: string): Record<string, unknown> {
  const t = text.trim()
  if (!t) return {}
  try {
    const v = JSON.parse(t) as unknown
    if (v !== null && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>
  } catch { /* plain text */ }
  return { content: t }
}

// ── Page entry ─────────────────────────────────────────────────────────────────

export default function AppDataDatabaseDetailPage({
  params,
}: {
  params: Promise<{ databaseId: string }>
}) {
  const { databaseId } = use(params)
  return <AppDataDatabaseDetailInner key={databaseId} databaseId={databaseId} />
}

function AppDataDatabaseDetailInner({ databaseId }: { databaseId: string }) {
  const queryClient = useQueryClient()

  // Table / rows open state
  const [openTableId, setOpenTableId]   = useState<string | null>(null)
  const [previewRecordId, setPreviewRecordId] = useState<string | null>(null)

  // Add table sheet
  const [tableSheetOpen, setTableSheetOpen] = useState(false)
  const [tableName, setTableName] = useState("")

  // Add column sheet
  const [colSheetOpen, setColSheetOpen] = useState(false)
  const [colName, setColName]     = useState("")
  const [colType, setColType]     = useState("text")
  const [colDefault, setColDefault] = useState("")
  const [colNullable, setColNullable] = useState(true)
  const [colPrimary, setColPrimary] = useState(false)

  // Add row sheet
  const [rowSheetOpen, setRowSheetOpen]         = useState(false)
  const [rowSheetForTableId, setRowSheetForTableId] = useState<string | null>(null)
  const [rowKey, setRowKey]   = useState("")
  const [rowValues, setRowValues] = useState<Record<string, string>>({})
  const [rowRawBody, setRowRawBody] = useState("")

  // Queries
  const meQuery      = useQuery({ queryKey: queryKeys.authMe, queryFn: ({ signal }) => getMe(signal) })
  const dbQuery      = useQuery({ queryKey: queryKeys.appDatabase(databaseId),    queryFn: ({ signal }) => getAppDatabase(databaseId, signal) })
  const foldersQuery = useQuery({ queryKey: queryKeys.appDatabaseFolders(databaseId), queryFn: ({ signal }) => listAppDatabaseFolders(databaseId, signal) })

  const sortedFolders = useMemo(() => {
    const list = foldersQuery.data ?? []
    return [...list].sort((a, b) => a.pathCache.localeCompare(b.pathCache))
  }, [foldersQuery.data])

  const effectiveTableId = useMemo(() => {
    if (!sortedFolders.length) return null
    if (openTableId && sortedFolders.some((f) => f.id === openTableId)) return openTableId
    return sortedFolders[0]?.id ?? null
  }, [sortedFolders, openTableId])

  // Columns stored in localStorage per table — seeded whenever the selected table changes.
  // React "adjusting state during render" pattern: store the last seeded id in state
  // so the guard is a plain state comparison rather than a ref (which triggers react-hooks/refs).
  const [columnsForTableId, setColumnsForTableId] = useState<string | null>(null)
  const [columns, setColumns] = useState<ColumnDef[]>([])
  if (effectiveTableId && columnsForTableId !== effectiveTableId) {
    setColumnsForTableId(effectiveTableId)
    setColumns(loadColumns(effectiveTableId))
  }

  const openFolder = sortedFolders.find((f) => f.id === effectiveTableId) ?? null

  const recordsQuery = useQuery({
    queryKey: queryKeys.appFolderRecords(effectiveTableId ?? "_"),
    queryFn: ({ signal }) => listFolderRecords(effectiveTableId!, signal),
    enabled: Boolean(effectiveTableId),
  })

  const role = meQuery.data?.user.role
  const canMutate = role === "OWNER" || role === "ADMIN" || role === "MEMBER"

  // ── Mutations ──

  const createFolderMutation = useMutation({
    mutationFn: () => createAppDatabaseFolder(databaseId, { name: tableName.trim() }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabaseFolders(databaseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabase(databaseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminTables })
      setTableSheetOpen(false); setTableName("")
      toast.success("Table created.")
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : "Could not create table.") },
  })

  const deleteFolderMutation = useMutation({
    mutationFn: (folderId: string) => deleteAppDatabaseFolder(folderId),
    onSuccess: (_data, folderId) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabaseFolders(databaseId) })
      if (openTableId === folderId) setOpenTableId(null)
      toast.success("Table removed.")
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : "Could not delete table.") },
  })

  const createRecordMutation = useMutation({
    mutationFn: () => {
      const tid = rowSheetForTableId ?? effectiveTableId!
      let payload: Record<string, unknown>

      if (columns.length > 0) {
        // Build payload from typed column values
        payload = {}
        for (const col of columns) {
          payload[col.name] = columnValueToTyped(col, rowValues[col.name] ?? col.defaultValue)
        }
      } else {
        // Fallback: raw JSON
        payload = payloadFromRaw(rowRawBody)
      }

      return createFolderRecord(tid, { name: rowKey.trim() || crypto.randomUUID(), payload })
    },
    onSuccess: () => {
      const tid = rowSheetForTableId ?? effectiveTableId!
      queryClient.invalidateQueries({ queryKey: queryKeys.appFolderRecords(tid) })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminTables })
      setRowSheetOpen(false); setRowKey(""); setRowValues({}); setRowRawBody(""); setRowSheetForTableId(null)
      toast.success("Row saved to PostgreSQL.")
    },
    onError: (e) => { toast.error(e instanceof Error ? e.message : "Could not save row.") },
  })

  const deleteRecordMutation = useMutation({
    mutationFn: (recordId: string) => deleteFolderRecord(recordId),
    onSuccess: (_data, recordId) => {
      if (effectiveTableId) queryClient.invalidateQueries({ queryKey: queryKeys.appFolderRecords(effectiveTableId) })
      if (previewRecordId === recordId) setPreviewRecordId(null)
      toast.success("Row deleted.")
    },
  })

  // ── Column management helpers ──

  function addColumn() {
    if (!colName.trim() || !effectiveTableId) return
    const newCol: ColumnDef = {
      id: crypto.randomUUID(),
      name: colName.trim(),
      type: colType,
      defaultValue: colDefault,
      nullable: colNullable,
      isPrimary: colPrimary,
    }
    const next = [...columns, newCol]
    setColumns(next)
    saveColumns(effectiveTableId, next)
    setColSheetOpen(false); setColName(""); setColType("text"); setColDefault(""); setColNullable(true); setColPrimary(false)
    toast.success("Column added.")
  }

  function removeColumn(id: string) {
    if (!effectiveTableId) return
    const next = columns.filter((c) => c.id !== id)
    setColumns(next)
    saveColumns(effectiveTableId, next)
  }

  function openAddRowSheet(tableId: string) {
    setRowSheetForTableId(tableId)
    setRowKey(""); setRowValues({}); setRowRawBody("")
    setRowSheetOpen(true)
  }

  const previewRecord = useMemo(
    () => (recordsQuery.data ?? []).find((r) => r.id === previewRecordId) ?? null,
    [recordsQuery.data, previewRecordId],
  )

  return (
    <div className="space-y-5 pb-6">
      {/* Back + header */}
      <div>
        <Button variant="ghost" size="sm" asChild className="mb-2 -ml-2 text-muted-foreground">
          <Link href="/database/app-data">
            <ArrowLeft className="mr-1 size-4" />
            App data databases
          </Link>
        </Button>
        <DashboardPageIntro
          title={dbQuery.data?.name ?? "Database"}
          subtitle={dbQuery.data ? `Logical store · ${dbQuery.data.slug}` : "Loading…"}
          description="Each table is a namespace; each row is a JSON document stored in PostgreSQL. Define columns to get a structured row form. Column schema is saved per-browser."
          stats={[
            { label: "Tables",       value: foldersQuery.isLoading ? "…" : String(foldersQuery.data?.length ?? 0) },
            { label: "Columns",      value: columns.length ? String(columns.length) : "—" },
            { label: "Rows in table",value: !effectiveTableId ? "—" : recordsQuery.isLoading ? "…" : String(recordsQuery.data?.length ?? 0) },
          ]}
        />
      </div>

      {/* ── Tables section ──────────────────────────────────────────────────── */}
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

        {foldersQuery.isLoading ? (
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
                      <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground">{formatRelativeDate(f.createdAt)}</TableCell>
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

      {/* ── Rows + Columns panel (below tables, when a table is open) ─────── */}
      {effectiveTableId && openFolder ? (
        <div className="space-y-4">

          {/* Column definitions */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Columns3 className="size-3.5 text-muted-foreground" />
                <h3 className="text-sm font-semibold text-foreground">
                  Columns — <span className="text-primary">{openFolder.name}</span>
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
              <div className="rounded-xl border border-dashed border-border bg-muted/10 px-4 py-3 text-[13px] text-muted-foreground">
                No columns defined. Add columns to enable a structured row form — or rows default to a free-form JSON payload.
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
          </div>

          {/* Rows */}
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-semibold text-foreground">
                  Rows — <span className="text-primary">{openFolder.name}</span>
                </h2>
                <Button type="button" variant="ghost" size="icon-sm" className="text-muted-foreground hover:text-foreground"
                  onClick={() => queryClient.invalidateQueries({ queryKey: queryKeys.appFolderRecords(effectiveTableId) })} title="Refresh">
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
                          <TableCell className="whitespace-nowrap tabular-nums font-medium text-muted-foreground">{formatRelativeDate(r.createdAt)}</TableCell>
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
        </div>
      ) : null}

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
              Define a column for <strong>{openFolder?.name}</strong>. Schema is saved in your browser.
            </SheetDescription>
          </SheetHeader>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
            <div className="space-y-1.5">
              <Label htmlFor="col-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Column name</Label>
              <Input id="col-name" value={colName} onChange={(e) => setColName(e.target.value)} placeholder="e.g. email" autoComplete="off" />
            </div>

            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Type</Label>
              <TypePicker value={colType} onChange={setColType} />
              <p className="text-[11px] text-muted-foreground">
                {PG_TYPES.find((t) => t.value === colType)?.label}
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
                  <p className="text-[11px] text-muted-foreground">Mark this column as the row identifier.</p>
                </div>
              </label>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
                <input type="checkbox" checked={colNullable} onChange={(e) => setColNullable(e.target.checked)} className="accent-primary" />
                <div>
                  <p className="text-[13px] font-medium text-foreground">Nullable</p>
                  <p className="text-[11px] text-muted-foreground">Allow NULL values for this column.</p>
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

      {/* ── Add row sheet ──────────────────────────────────────────────────── */}
      <Sheet open={rowSheetOpen} onOpenChange={(next) => { setRowSheetOpen(next); if (!next) { setRowKey(""); setRowValues({}); setRowRawBody(""); setRowSheetForTableId(null) } }}>
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
                ? `Fill in the ${columns.length} column${columns.length === 1 ? "" : "s"} defined for this table.`
                : "No columns defined — enter a key and optional JSON payload."}
            </SheetDescription>
          </SheetHeader>

          <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-5 py-5">
            {/* Row key — always present */}
            <div className="space-y-1.5">
              <Label htmlFor="row-key" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                Row key <span className="normal-case font-normal text-muted-foreground">(optional — auto-generated if blank)</span>
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
                  Payload <span className="normal-case font-normal">(optional)</span>
                </Label>
                <textarea
                  id="row-body"
                  className="min-h-[140px] w-full rounded-xl border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30"
                  value={rowRawBody}
                  onChange={(e) => setRowRawBody(e.target.value)}
                  placeholder={'Empty, or {"total": 42}, or plain text'}
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty for <code className="rounded bg-muted px-1">{"{}"}</code>. Add columns above for a structured form.
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
    </div>
  )
}

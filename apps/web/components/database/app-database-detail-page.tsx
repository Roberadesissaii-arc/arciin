"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowLeft, Database } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { notifyDeleted } from "@/lib/notifications/toast-actions"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { Button } from "@/components/ui/button"
import { AppDatabaseTablesPanel } from "@/components/database/app-database-tables-panel"
import { AppDatabaseColumnsPanel } from "@/components/database/app-database-columns-panel"
import { AppDatabaseRowsPanel } from "@/components/database/app-database-rows-panel"
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
import {
  columnValueToTyped,
  loadColumns,
  payloadFromRaw,
  saveColumns,
  type ColumnDef,
} from "@/lib/database/column-schema"

export function AppDatabaseDetailPage({ databaseId }: { databaseId: string }) {
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
      notifyDeleted({ kind: "row" })
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
          cornerDecoration={<IntroCornerIcon icon={Database} />}
          description="Think of a table like a spreadsheet tab. Add rows to save entries — no setup needed. Want each row to follow the same fields (like spreadsheet headers)? Add columns to a table first, and rows below will show a form instead of a free-text box."
          stats={[
            { label: "Tables",       value: foldersQuery.isLoading ? "…" : String(foldersQuery.data?.length ?? 0) },
            { label: "Columns",      value: columns.length ? String(columns.length) : "—" },
            { label: "Rows in table",value: !effectiveTableId ? "—" : recordsQuery.isLoading ? "…" : String(recordsQuery.data?.length ?? 0) },
          ]}
        />
      </div>

      <AppDatabaseTablesPanel
        foldersLoading={foldersQuery.isLoading}
        sortedFolders={sortedFolders}
        effectiveTableId={effectiveTableId}
        canMutate={canMutate}
        tableSheetOpen={tableSheetOpen}
        setTableSheetOpen={setTableSheetOpen}
        tableName={tableName}
        setTableName={setTableName}
        createFolderMutation={createFolderMutation}
        deleteFolderMutation={deleteFolderMutation}
        setOpenTableId={setOpenTableId}
        setPreviewRecordId={setPreviewRecordId}
        openAddRowSheet={openAddRowSheet}
      />

      {/* ── Rows + Columns panel (below tables, when a table is open) ─────── */}
      {effectiveTableId && openFolder ? (
        <div className="space-y-4">
          <AppDatabaseColumnsPanel
            tableName={openFolder.name}
            columns={columns}
            canMutate={canMutate}
            colSheetOpen={colSheetOpen}
            setColSheetOpen={setColSheetOpen}
            colName={colName}
            setColName={setColName}
            colType={colType}
            setColType={setColType}
            colDefault={colDefault}
            setColDefault={setColDefault}
            colNullable={colNullable}
            setColNullable={setColNullable}
            colPrimary={colPrimary}
            setColPrimary={setColPrimary}
            addColumn={addColumn}
            removeColumn={removeColumn}
          />

          <AppDatabaseRowsPanel
            tableName={openFolder.name}
            recordsQuery={recordsQuery}
            previewRecordId={previewRecordId}
            setPreviewRecordId={setPreviewRecordId}
            previewRecord={previewRecord}
            canMutate={canMutate}
            deleteRecordMutation={deleteRecordMutation}
            onRefresh={() => queryClient.invalidateQueries({ queryKey: queryKeys.appFolderRecords(effectiveTableId) })}
            rowSheetOpen={rowSheetOpen}
            onRowSheetOpenChange={(next) => { setRowSheetOpen(next); if (!next) { setRowKey(""); setRowValues({}); setRowRawBody(""); setRowSheetForTableId(null) } }}
            columns={columns}
            rowKey={rowKey}
            setRowKey={setRowKey}
            rowValues={rowValues}
            setRowValues={setRowValues}
            rowRawBody={rowRawBody}
            setRowRawBody={setRowRawBody}
            createRecordMutation={createRecordMutation}
          />
        </div>
      ) : null}
    </div>
  )
}

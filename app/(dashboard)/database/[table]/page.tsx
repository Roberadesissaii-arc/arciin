"use client"

import { useState } from "react"
import Link from "next/link"
import { use } from "react"
import { useQuery } from "@tanstack/react-query"
import { AlertCircle, ArrowLeft, Database, Loader2, RefreshCw } from "lucide-react"

import { AppPagination } from "@/components/ui/app-pagination"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { getAdminTableData, getAdminTables } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

const PILL_COLORS: Record<string, string> = {
  OWNER: "#6366f1",
  ADMIN: "#2563eb",
  MEMBER: "#65a30d",
  VIEWER: "#64748b",
  ACTIVE: "#16a34a",
  DISABLED: "#dc2626",
  READY: "#16a34a",
  FAILED: "#dc2626",
  UPLOADING: "#d97706",
  PROCESSING: "#2563eb",
  DELETED: "#6b7280",
  QUEUED: "#d97706",
  COMPLETED: "#16a34a",
  VIDEO: "#6366f1",
  IMAGE: "#2563eb",
  AUDIO: "#db2777",
  DOCUMENT: "#ea580c",
  ARCHIVE: "#7c3aed",
  OTHER: "#64748b",
  true: "#16a34a",
  false: "#64748b",
}

function CellValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) {
    return <span className="font-mono text-xs text-zinc-400">null</span>
  }
  if (typeof value === "boolean") {
    const color = PILL_COLORS[String(value)] ?? "#64748b"
    return (
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {String(value)}
      </span>
    )
  }
  const str = String(value)
  const color = PILL_COLORS[str]
  if (color) {
    return (
      <span
        className="rounded-md px-2 py-0.5 text-[11px] font-semibold"
        style={{ backgroundColor: `${color}22`, color }}
      >
        {str}
      </span>
    )
  }
  if (/^\d{4}-\d{2}-\d{2}T/.test(str)) {
    return (
      <span className="font-mono text-[11px] text-zinc-600">{new Date(str).toLocaleString()}</span>
    )
  }
  if (/^c[a-z0-9]{20,}$/.test(str)) {
    return <span className="font-mono text-[11px] text-zinc-600">{str.slice(0, 8)}…</span>
  }
  if (str.length > 48) {
    return (
      <span className="text-zinc-800" title={str}>
        {str.slice(0, 48)}…
      </span>
    )
  }
  return <span className="text-zinc-800">{str}</span>
}

export default function TablePage({ params }: { params: Promise<{ table: string }> }) {
  const { table } = use(params)
  const [page, setPage] = useState(1)

  const metaQuery = useQuery({
    queryKey: queryKeys.adminTables,
    queryFn: ({ signal }) => getAdminTables(signal),
  })

  const dataQuery = useQuery({
    queryKey: queryKeys.adminTableData(table, page),
    queryFn: ({ signal }) => getAdminTableData(table, page, signal),
    placeholderData: (prev) => prev,
  })

  const meta = metaQuery.data?.find((t) => t.name === table)
  const data = dataQuery.data
  const columns = data?.rows[0] ? Object.keys(data.rows[0]) : []
  const totalPages = data?.totalPages ?? 1

  const catalogLoading = metaQuery.isLoading
  const catalogError = metaQuery.isError
  const unknownTable = metaQuery.isSuccess && !meta
  const rowsLoading =
    Boolean(meta) &&
    !dataQuery.isError &&
    dataQuery.data === undefined &&
    dataQuery.isLoading
  const rowsError = Boolean(meta) && dataQuery.isError
  const rowsEmpty = Boolean(meta) && dataQuery.isSuccess && data && !data.rows.length

  return (
    <div className="space-y-5 pb-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="icon" className="size-9 shrink-0 rounded-lg" asChild>
          <Link href="/database" aria-label="Back to database">
            <ArrowLeft className="size-3.5" />
          </Link>
        </Button>
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm text-muted-foreground">
          <Database className="size-4 shrink-0" aria-hidden />
          <span className="truncate">Database</span>
          <span className="text-zinc-300">/</span>
          <span className="truncate font-semibold text-foreground">{meta?.label ?? table}</span>
        </div>
        {data ? (
          <span className="rounded-lg border border-border bg-muted/60 px-2.5 py-1 text-[11px] font-bold tabular-nums text-muted-foreground">
            {data.total.toLocaleString()} rows
          </span>
        ) : null}
      </div>

      {meta ? <p className="text-sm text-muted-foreground">{meta.description}</p> : null}

      <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm ring-1 ring-black/[0.03]">
        {catalogLoading ? (
          <Empty className="border-0 bg-muted/10 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Loader2 className="size-4 animate-spin text-primary" />
              </EmptyMedia>
              <EmptyTitle>Loading table catalog</EmptyTitle>
              <EmptyDescription>
                Fetching the list of admin tables from the API. If this stays here, confirm the API is running.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : catalogError ? (
          <Empty className="border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertCircle className="size-4 text-red-600" />
              </EmptyMedia>
              <EmptyTitle>Could not load catalog</EmptyTitle>
              <EmptyDescription>
                The admin tables list failed to load. Check that you are signed in as an owner or admin and the API is
                reachable.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => metaQuery.refetch()}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </Empty>
        ) : unknownTable ? (
          <Empty className="border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database className="size-4 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>Unknown table</EmptyTitle>
              <EmptyDescription>
                No table named <span className="font-mono text-foreground">{table}</span> was found. Return to the
                database hub and pick a valid table.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" variant="outline" size="sm" asChild>
              <Link href="/database">Back to tables</Link>
            </Button>
          </Empty>
        ) : rowsLoading ? (
          <Empty className="border-0 bg-muted/10 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Loader2 className="size-4 animate-spin text-primary" />
              </EmptyMedia>
              <EmptyTitle>Loading rows</EmptyTitle>
              <EmptyDescription>
                Pulling a page of data from PostgreSQL. Large tables can take a few seconds.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : rowsError ? (
          <Empty className="border-0 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <AlertCircle className="size-4 text-red-600" />
              </EmptyMedia>
              <EmptyTitle>Could not load table data</EmptyTitle>
              <EmptyDescription>
                Make sure the API is running and your account has admin access. Network or permission errors show here
                instead of an endless loading state.
              </EmptyDescription>
            </EmptyHeader>
            <Button type="button" variant="outline" size="sm" onClick={() => dataQuery.refetch()}>
              <RefreshCw className="mr-2 size-4" />
              Retry
            </Button>
          </Empty>
        ) : rowsEmpty ? (
          <Empty className="border border-dashed border-border bg-muted/5 py-16">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database className="size-4 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>No rows yet</EmptyTitle>
              <EmptyDescription>
                This table exists but has no records. New writes from the app or migrations will appear here—same idea
                as an empty library before the first upload.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max text-left text-[12px]">
              <thead>
                <tr className="border-b border-border bg-zinc-50/95">
                  {columns.map((col) => (
                    <th
                      key={col}
                      className="px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-zinc-500"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data!.rows.map((row, i) => (
                  <tr
                    key={i}
                    className={cn(
                      "border-b border-border transition-colors last:border-b-0 hover:bg-muted/50",
                    )}
                  >
                    {columns.map((col) => (
                      <td key={col} className="px-4 py-2.5 align-middle">
                        <CellValue value={row[col]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 && (
            <div className="border-t border-border px-4 py-3">
              <AppPagination page={page} totalPages={totalPages} onPageChange={setPage} />
            </div>
          )}
          </>
        )}
      </div>

    </div>
  )
}

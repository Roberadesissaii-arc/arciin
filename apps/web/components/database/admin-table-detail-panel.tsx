"use client"

import { useState } from "react"
import Link from "next/link"
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
import { AdminTableHero } from "@/components/database/admin-table-hero"
import { CellValue } from "@/components/database/table-cell-value"
import {
  API_KEY_STATUS_FILTERS,
  getAdminTableData,
  getAdminTables,
  type ApiKeyStatusFilter,
} from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"

export function AdminTableDetailPanel({ table }: { table: string }) {
  const [page, setPage] = useState(1)
  /**
   * Database → API Keys is the audit view: revoked and expired keys stay,
   * because deleting history to tidy a list would destroy the record of who
   * had access when. The filter narrows the view without touching rows.
   * Default All. Developer → API Keys is where keys are managed.
   */
  const [status, setStatus] = useState<ApiKeyStatusFilter>("all")
  const statusFilterable = table === "api-keys"
  const effectiveStatus = statusFilterable ? status : "all"

  const metaQuery = useQuery({
    queryKey: queryKeys.adminTables,
    queryFn: ({ signal }) => getAdminTables(signal),
  })

  const dataQuery = useQuery({
    queryKey: queryKeys.adminTableData(table, page, effectiveStatus),
    queryFn: ({ signal }) => getAdminTableData(table, page, signal, { status: effectiveStatus }),
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

      {/*
        Was a bare one-line description under the breadcrumb, which made a
        detail page feel like a fragment of the hub rather than a page. The
        hero reads its title, description and metrics from the same catalogue
        the hub cards use, so the two cannot describe the same table
        differently.
      */}
      {meta ? (
        <AdminTableHero
          table={meta.name}
          label={meta.label}
          description={meta.description}
          summary={meta.summary}
        />
      ) : null}

      {statusFilterable && meta ? (
        <div
          role="radiogroup"
          aria-label="Filter API keys by status"
          className="flex flex-wrap items-center gap-2"
        >
          {API_KEY_STATUS_FILTERS.map((value) => {
            const selected = status === value
            return (
              <Button
                key={value}
                type="button"
                role="radio"
                aria-checked={selected}
                size="sm"
                variant="outline"
                data-testid={`api-key-filter-${value}`}
                className={cn(
                  "h-8 rounded-full border-border bg-card px-3 text-xs font-semibold capitalize text-muted-foreground",
                  selected && "border-primary/40 bg-primary/10 text-primary",
                )}
                onClick={() => {
                  setStatus(value)
                  setPage(1)
                }}
              >
                {value}
              </Button>
            )
          })}
        </div>
      ) : null}

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
              {effectiveStatus !== "all" ? (
                <>
                  <EmptyTitle>No {effectiveStatus} keys</EmptyTitle>
                  <EmptyDescription>
                    No API key is currently {effectiveStatus}. Choose All to see every key this instance has issued.
                  </EmptyDescription>
                </>
              ) : (
                <>
                  <EmptyTitle>No rows yet</EmptyTitle>
                  <EmptyDescription>
                    This table exists but has no records. New writes from the app or migrations will appear here—same
                    idea as an empty library before the first upload.
                  </EmptyDescription>
                </>
              )}
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

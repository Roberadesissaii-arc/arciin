"use client"

import Link from "next/link"
import { ArrowRight, Trash2 } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { ConfirmDestructiveButton } from "@/components/shared/confirm-destructive-button"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { approxDatabaseIndexBytes, typeBadgeClass } from "@/lib/database/table-format"
import { formatBytes } from "@/lib/utils/format-bytes"
import { cn } from "@/lib/utils"
import type { AppDatabaseSummary } from "@/lib/types/models"
import { RelativeTime } from "@/components/shared/relative-time"

/**
 * Was a hardcoded #EF4444. The same red as the token today, but a literal
 * does not follow the theme and carries no focus or dark handling of its own.
 * Paired with variant="destructive" at the call sites.
 */
const deleteButtonClass =
  "shadow-none"

type MutationLike<TVariables = void> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
  mutateAsync: (variables: TVariables) => Promise<unknown>
}

export function AppDatabaseListTable({
  databases,
  canMutate,
  deleteMutation,
}: {
  databases: AppDatabaseSummary[]
  canMutate: boolean
  deleteMutation: MutationLike<string>
}) {
  return (
    <div className="min-w-0 max-w-full overflow-x-auto rounded-3xl border border-border bg-card p-3">
      <Table className="w-full min-w-[900px] table-fixed">
        <colgroup>
          <col style={{ width: "38%" }} />
          <col style={{ width: "14%" }} />
          <col style={{ width: "12%" }} />
          <col style={{ width: "16%" }} />
          <col style={{ width: "20%" }} />
        </colgroup>
        <TableHeader>
          <TableRow className="border-border hover:bg-transparent">
            <TableHead className="min-w-0 text-left font-semibold text-zinc-700">Name</TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Type</TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Size</TableHead>
            <TableHead className="text-left font-semibold text-zinc-700">Created</TableHead>
            <TableHead className="text-right font-semibold text-zinc-700">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {databases.map((db) => (
            <TableRow
              key={db.id}
              className="border-border hover:bg-card [&>td]:align-middle [&>td]:py-2.5"
            >
              <TableCell className="max-w-0 py-2.5">
                <span
                  className="block w-full truncate font-medium text-foreground"
                  title={`${db.name} · ${db.slug}`}
                >
                  {db.name}
                </span>
                {db.description?.trim() ? (
                  <span className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={db.description}>
                    {db.description.trim()}
                  </span>
                ) : null}
              </TableCell>
              <TableCell className="whitespace-nowrap">
                <Badge
                  className={cn(
                    "inline-flex h-7 min-w-[5.75rem] shrink-0 justify-center rounded-md px-2.5 tabular-nums",
                    typeBadgeClass,
                  )}
                >
                  APP DB
                </Badge>
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums font-medium text-zinc-700">
                {formatBytes(approxDatabaseIndexBytes(db))}
              </TableCell>
              <TableCell className="whitespace-nowrap tabular-nums font-medium text-zinc-700">
                <RelativeTime value={db.createdAt} />
              </TableCell>
              <TableCell className="text-right whitespace-nowrap">
                <div className="flex shrink-0 flex-nowrap items-center justify-end gap-2">
                  <Button variant="outline" size="sm" asChild className="border-border bg-card text-foreground hover:bg-muted/50">
                    <Link href={`/database/app-data/${db.id}`} className="gap-1">
                      Open
                      <ArrowRight className="size-3" />
                    </Link>
                  </Button>
                  {canMutate ? (
                    <ConfirmDestructiveButton
                      title={`Delete database “${db.name}”?`}
                      description="Every table and row in this database is deleted permanently. Files uploaded to your libraries are not affected. This cannot be undone."
                      confirmLabel="Delete database"
                      className={deleteButtonClass}
                      pending={deleteMutation.isPending}
                      onConfirm={() => deleteMutation.mutateAsync(db.id)}
                      aria-label={`Delete database ${db.name}`}
                      data-testid="app-database-delete"
                    >
                      <Trash2 className="size-4" />
                      Delete
                    </ConfirmDestructiveButton>
                  ) : null}
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

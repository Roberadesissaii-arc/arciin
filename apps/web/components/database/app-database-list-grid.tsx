"use client"

import Link from "next/link"
import { ArrowRight, Layers2, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import { formatRelativeDate } from "@/lib/utils/format-date"
import type { AppDatabaseSummary } from "@/lib/types/models"

const deleteButtonClass =
  "border-0 bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626] focus-visible:ring-2 focus-visible:ring-[#EF4444]/50"

type MutationLike<TVariables = void> = {
  isPending: boolean
  mutate: (variables: TVariables) => void
}

export function AppDatabaseListGrid({
  databases,
  canMutate,
  deleteMutation,
}: {
  databases: AppDatabaseSummary[]
  canMutate: boolean
  deleteMutation: MutationLike<string>
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {databases.map((db) => (
        <div
          key={db.id}
          className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card p-5 shadow-sm ring-1 ring-black/[0.03] transition hover:border-primary/30 hover:shadow-md"
        >
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/60 text-primary shadow-inner">
              <Layers2 className="size-5" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-semibold tracking-tight text-foreground">{db.name}</p>
              <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{db.slug}</p>
              <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
                {db.folderCount} table{db.folderCount === 1 ? "" : "s"} · {formatRelativeDate(db.createdAt)}
              </p>
              {db.description?.trim() ? (
                <p className="mt-2 line-clamp-2 text-[11px] text-muted-foreground">{db.description.trim()}</p>
              ) : null}
            </div>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-border pt-4">
            <Button variant="outline" size="sm" asChild className="border-border bg-card text-foreground hover:bg-muted/50">
              <Link href={`/database/app-data/${db.id}`} className="gap-1.5">
                Open
                <ArrowRight className="size-3.5" />
              </Link>
            </Button>
            {canMutate ? (
              <Button
                type="button"
                variant="default"
                size="sm"
                className={deleteButtonClass}
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (window.confirm(`Delete database “${db.name}” and all tables and rows?`)) {
                    deleteMutation.mutate(db.id)
                  }
                }}
              >
                <Trash2 className="size-4" />
                Delete
              </Button>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

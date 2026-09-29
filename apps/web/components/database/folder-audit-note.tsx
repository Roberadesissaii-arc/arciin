"use client"

import { useQuery } from "@tanstack/react-query"
import { Info } from "lucide-react"

import { getFolderAudit } from "@/lib/api/admin"
import { queryKeys } from "@/lib/api/query-keys"

/**
 * One paragraph above Database → Folders saying what the rows are.
 *
 * Most folder records on an instance that once ran Computer Backup are that
 * feature's kept trees, not folders anyone can open. Read-only: nothing here
 * offers to delete them.
 */
export function FolderAuditNote() {
  const audit = useQuery({
    queryKey: queryKeys.folderAudit,
    queryFn: ({ signal }) => getFolderAudit(signal),
  })
  const a = audit.data
  if (!a) return null
  const fmt = (value: number) => value.toLocaleString()
  return (
    <div
      className="flex gap-3 rounded-2xl border border-border bg-card px-4 py-3 text-[12px] leading-relaxed text-muted-foreground"
      data-testid="folder-audit-note"
    >
      <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
      <p>
        <span className="font-semibold text-foreground">{fmt(a.current)} current</span> folders across your
        libraries ({fmt(a.currentWithAssets)} holding files).{" "}
        {a.legacyComputer > 0 ? (
          <>
            <span className="font-semibold text-foreground">{fmt(a.legacyComputer)} legacy Computer Backup</span>{" "}
            folders from {fmt(a.legacyRoots.count)} backed-up {a.legacyRoots.count === 1 ? "root" : "roots"} are kept
            as history ({fmt(a.legacyWithAssets)} holding {fmt(a.legacyAssets)} files; {fmt(a.legacyWithoutAssets)} empty).{" "}
          </>
        ) : null}
        {a.deleted > 0 ? <>{fmt(a.deleted)} deleted records remain for restore and audit. </> : null}
        This is a read-only view; nothing is removed.
      </p>
    </div>
  )
}

"use client"

import { useMemo, useState } from "react"

import { useQuery } from "@tanstack/react-query"
import { History, LogIn, LogOut, ShieldAlert, KeyRound, Ban } from "lucide-react"

import { Skeleton } from "@/components/ui/skeleton"
import { getSecurityActivity } from "@/lib/api/activity"
import { queryKeys } from "@/lib/api/query-keys"
import { AppPagination } from "@/components/ui/app-pagination"
import { cn } from "@/lib/utils"
import { RelativeTime } from "@/components/shared/relative-time"

/**
 * Security events are deliberately filtered out of the Activity feed, so until
 * now they were recorded but unreadable outside the raw log files. This is
 * their home: who signed in, from where, and what failed.
 */
const EVENT_STYLE: Record<
  string,
  { Icon: typeof LogIn; tone: string; label: string }
> = {
  "auth.login": { Icon: LogIn, tone: "text-emerald-600", label: "Signed in" },
  "auth.login_failed": { Icon: ShieldAlert, tone: "text-amber-600", label: "Failed sign-in" },
  "auth.logout": { Icon: LogOut, tone: "text-muted-foreground", label: "Signed out" },
  "auth.sessions_revoked": { Icon: LogOut, tone: "text-amber-600", label: "Sessions revoked" },
  "security.password_changed": { Icon: KeyRound, tone: "text-blue-600", label: "Password changed" },
  "security.password_recovered": { Icon: KeyRound, tone: "text-amber-600", label: "Password recovered" },
  "security.recovery_failed": { Icon: ShieldAlert, tone: "text-red-600", label: "Recovery failed" },
  "security.ip_denied": { Icon: Ban, tone: "text-red-600", label: "Blocked request" },
}

function styleFor(type: string) {
  return (
    EVENT_STYLE[type] ?? {
      Icon: ShieldAlert,
      tone: "text-muted-foreground",
      label: type.replace(/^security\.|^auth\./, "").replace(/_/g, " "),
    }
  )
}

/** Rows per page — enough to scan, short enough to keep the card a fixed size. */
const PAGE_SIZE = 10

export function SignInHistoryPanel() {
  const query = useQuery({
    queryKey: queryKeys.securityActivity,
    queryFn: ({ signal }) => getSecurityActivity(signal),
    staleTime: 30_000,
  })

  const rows = useMemo(() => query.data ?? [], [query.data])

  /**
   * Paged, because this list only grows.
   *
   * Every sign-in appends a row and nothing ever removes one, so on a server in
   * daily use the panel became the longest thing on the page and pushed
   * everything below it out of reach. Ten keeps the card a fixed height whatever
   * the history holds.
   */
  const [page, setPage] = useState(1)
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE))
  const safePage = Math.min(page, totalPages)
  const pageRows = useMemo(
    () => rows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    [rows, safePage],
  )

  return (
    <section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/30 px-5 py-3.5">
        <History className="size-4 text-primary" />
        <span className="text-sm font-semibold text-foreground">Sign-in history</span>
        {rows.length > 0 ? (
          <span className="ml-auto rounded-md bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            {rows.length} event{rows.length === 1 ? "" : "s"}
          </span>
        ) : null}
      </div>

      {query.isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-10 w-full rounded-lg" />
          ))}
        </div>
      ) : query.isError ? (
        <p className="px-5 py-8 text-center text-[13px] text-muted-foreground">
          Could not load sign-in history.
        </p>
      ) : rows.length === 0 ? (
        <p className="px-5 py-10 text-center text-[13px] text-muted-foreground">
          No sign-in activity recorded yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {pageRows.map((row) => {
            const { Icon, tone, label } = styleFor(row.type)
            return (
              <li key={row.id} className="flex items-start gap-3 px-5 py-3">
                <Icon className={cn("mt-0.5 size-4 shrink-0", tone)} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-medium text-foreground">{label}</p>
                  {row.message ? (
                    <p className="mt-0.5 break-words text-[12px] text-muted-foreground">
                      {row.message}
                    </p>
                  ) : null}
                </div>
                <span
                  className="shrink-0 text-[11px] tabular-nums text-muted-foreground"
                  suppressHydrationWarning
                >
                  <RelativeTime value={row.createdAt} />
                </span>
              </li>
            )
          })}
        </ul>
      )}

      {!query.isLoading && !query.isError && totalPages > 1 ? (
        <div className="flex justify-center border-t border-border px-5 py-3">
          <AppPagination page={safePage} totalPages={totalPages} onPageChange={setPage} />
        </div>
      ) : null}
    </section>
  )
}

"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ArrowRight, Grid3X3, Layers2, List, Loader2, Plus, RefreshCw, Search, Trash2, X } from "lucide-react"
import { toast } from "sonner"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  createAppDatabase,
  deleteAppDatabase,
  listAppDatabases,
} from "@/lib/api/app-databases"
import { getMe } from "@/lib/api/auth"
import { queryKeys } from "@/lib/api/query-keys"
import { libraryGlassSheetPanel } from "@/lib/library-glass-sheet"
import { formatBytes } from "@/lib/utils/format-bytes"
import { formatRelativeDate } from "@/lib/utils/format-date"
import type { AppDatabaseSummary } from "@/lib/types/models"
import { cn } from "@/lib/utils"

const ADJ = ["bright", "swift", "calm", "deep", "fresh", "golden", "bold", "clean", "smart", "warm", "sharp", "quiet"]
const NOUN = ["store", "hub", "base", "vault", "pool", "node", "core", "shelf", "stack", "deck", "log", "cache"]
function generateName() {
  return `${ADJ[Math.floor(Math.random() * ADJ.length)]}-${NOUN[Math.floor(Math.random() * NOUN.length)]}`
}

/** Match `AssetTable` — primary fill for type badge. */
const typeBadgeClass =
  "border-0 bg-primary text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90"

const deleteButtonClass =
  "border-0 bg-[#EF4444] text-white shadow-none hover:bg-[#DC2626] focus-visible:ring-2 focus-visible:ring-[#EF4444]/50"

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function approxDatabaseIndexBytes(db: AppDatabaseSummary): number {
  const meta = JSON.stringify({
    name: db.name,
    slug: db.slug,
    description: db.description ?? "",
  })
  return utf8ByteLength(meta) + Math.max(0, db.folderCount) * 400
}

function filterDatabases(list: AppDatabaseSummary[], q: string): AppDatabaseSummary[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return list
  return list.filter((db) => {
    const hay = `${db.name} ${db.slug} ${db.description ?? ""}`.toLowerCase()
    return hay.includes(needle)
  })
}

export default function AppDataDatabasesPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<"grid" | "table">("table")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => generateName())
  const [description, setDescription] = useState("")

  const meQuery = useQuery({
    queryKey: queryKeys.authMe,
    queryFn: ({ signal }) => getMe(signal),
  })

  const listQuery = useQuery({
    queryKey: queryKeys.appDatabases,
    queryFn: ({ signal }) => listAppDatabases(signal),
  })

  const filtered = useMemo(
    () => filterDatabases(listQuery.data ?? [], search),
    [listQuery.data, search],
  )

  const createMutation = useMutation({
    mutationFn: () => createAppDatabase({ name: name.trim(), description: description.trim() || undefined }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabases })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminTables })
      queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
      setOpen(false)
      setName(generateName())
      setDescription("")
      toast.success("Database created with a Default table.")
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not create database.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (databaseId: string) => deleteAppDatabase(databaseId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabases })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminTables })
      queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
      toast.success("Database deleted.")
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not delete database.")
    },
  })

  const role = meQuery.data?.user.role
  const canMutate = role === "OWNER" || role === "ADMIN" || role === "MEMBER"

  return (
    <div className="space-y-5 pb-6">
      <DashboardPageIntro
        title="App data databases"
        subtitle="PostgreSQL + Prisma · logical stores"
        description="Each database is registered in Arciin’s Postgres (not a disk folder). New databases get a Default table automatically; add more tables for different shapes of JSON rows. Use API keys with appdata scopes for automation."
        stats={[
          { label: "Databases", value: listQuery.isLoading ? "…" : String(listQuery.data?.length ?? 0) },
          { label: "Auth", value: "Session or Bearer" },
          { label: "Rows", value: "JSON in DB" },
        ]}
      />

      <div className="rounded-2xl border border-border bg-card/60 p-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">Quick links</p>
        <ul className="mt-2 list-inside list-disc space-y-1">
          <li>
            <Link href="/database" className="text-primary underline-offset-4 hover:underline">
              PostgreSQL table browser
            </Link>
          </li>
          <li>
            <Link href="/developer/api-keys" className="text-primary underline-offset-4 hover:underline">
              Create API keys with appdata scopes
            </Link>
          </li>
        </ul>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Layers2 className="size-4 text-primary" aria-hidden />
          <span>Your logical databases</span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant={view === "grid" ? "default" : "outline"}
            size="sm"
            className={
              view === "grid"
                ? "bg-primary text-white hover:bg-primary/90"
                : "border-border bg-card text-foreground hover:bg-muted/50"
            }
            onClick={() => setView("grid")}
          >
            <Grid3X3 className="size-4" />
            Grid
          </Button>
          <Button
            type="button"
            variant={view === "table" ? "default" : "outline"}
            size="sm"
            className={
              view === "table"
                ? "bg-primary text-white hover:bg-primary/90"
                : "border-border bg-card text-foreground hover:bg-muted/50"
            }
            onClick={() => setView("table")}
          >
            <List className="size-4" />
            Table
          </Button>
          {canMutate ? (
            <Sheet open={open} onOpenChange={(next) => {
              setOpen(next)
              if (!next) { setName(generateName()); setDescription("") }
            }}>
              <SheetTrigger asChild>
                <Button size="sm" className="gap-1.5 bg-primary text-white hover:bg-primary/90">
                  <Plus className="size-4" />
                  New database
                </Button>
              </SheetTrigger>
              <SheetContent
                side="right"
                showCloseButton={false}
                className={cn(libraryGlassSheetPanel, "dashboard-main text-foreground")}
              >
                <SheetHeader className="relative shrink-0 border-b border-border px-5 py-4 pr-12">
                  <SheetClose asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="absolute right-4 top-4 text-muted-foreground hover:text-foreground"
                      aria-label="Close"
                    >
                      <X className="size-4" />
                    </Button>
                  </SheetClose>
                  <SheetTitle className="text-[15px] font-semibold text-foreground">
                    New app data database
                  </SheetTitle>
                  <SheetDescription className="text-[13px] text-muted-foreground">
                    A Default table is created in Postgres so you can add rows immediately.
                  </SheetDescription>
                </SheetHeader>

                <div className="scrollbar-hide flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-5">
                  <div className="space-y-1.5">
                    <Label htmlFor="adb-name" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Name
                    </Label>
                    <div className="flex items-center gap-2">
                      <Input
                        id="adb-name"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="e.g. ecommerce"
                        autoComplete="off"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        className="shrink-0"
                        title="Generate name"
                        onClick={() => setName(generateName())}
                      >
                        <RefreshCw className="size-3.5" />
                      </Button>
                    </div>
                    <p className="text-[11px] text-muted-foreground">e.g. ecommerce — auto-generated, you can edit it.</p>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="adb-desc" className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Description <span className="normal-case font-normal">(optional)</span>
                    </Label>
                    <Input
                      id="adb-desc"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="What this store is for"
                      autoComplete="off"
                    />
                  </div>
                </div>

                <SheetFooter className="shrink-0 border-t border-border px-5 py-4">
                  <Button
                    type="button"
                    className="h-10 w-full bg-primary text-white hover:bg-primary/90"
                    onClick={() => createMutation.mutate()}
                    disabled={createMutation.isPending || !name.trim()}
                  >
                    {createMutation.isPending ? "Creating…" : "Create database"}
                  </Button>
                </SheetFooter>
              </SheetContent>
            </Sheet>
          ) : null}
        </div>
      </div>

      <div className="w-full min-w-0 rounded-2xl border border-border bg-muted/30 px-3 py-2.5 sm:px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Search className="size-4 shrink-0 text-zinc-600" aria-hidden />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, slug, or description"
            className="h-10 min-w-0 flex-1 border-0 bg-transparent py-0 pl-2 pr-2 text-sm text-foreground placeholder:text-zinc-500 focus-visible:ring-0 sm:pl-3 sm:pr-3"
          />
        </div>
      </div>

      {listQuery.isLoading ? (
        <Empty className="rounded-2xl border border-dashed border-border bg-muted/10 py-16">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Loader2 className="size-4 animate-spin text-primary" />
            </EmptyMedia>
            <EmptyTitle>Loading databases</EmptyTitle>
            <EmptyDescription>
              Fetching your logical stores from the API. If this hangs, confirm the server is running.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : listQuery.isError ? (
        <div className="rounded-2xl border border-red-500/25 bg-red-50 p-4 text-sm text-red-800">
          Could not load app databases. Ensure the API is running and you are signed in.
        </div>
      ) : !listQuery.data?.length ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No app data databases yet.
          {canMutate ? " Create one to get a Default table and start adding JSON rows." : null}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
          No databases match your search.
        </div>
      ) : view === "grid" ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((db) => (
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
      ) : (
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
              {filtered.map((db) => (
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
                    {formatRelativeDate(db.createdAt)}
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
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  )
}

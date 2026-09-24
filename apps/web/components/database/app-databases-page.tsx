"use client"

import Link from "next/link"
import { useMemo, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Grid3X3, Layers2, List, Loader2, Search } from "lucide-react"
import { toast } from "@/lib/notifications/arciin-toast"

import { notifyDeleted } from "@/lib/notifications/toast-actions"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { Input } from "@/components/ui/input"
import { AppDatabaseListGrid } from "@/components/database/app-database-list-grid"
import { AppDatabaseListTable } from "@/components/database/app-database-list-table"
import { CreateAppDatabaseSheet } from "@/components/database/create-app-database-sheet"
import {
  createAppDatabase,
  deleteAppDatabase,
  listAppDatabases,
} from "@/lib/api/app-databases"
import { getMe } from "@/lib/api/auth"
import { queryKeys } from "@/lib/api/query-keys"
import { filterDatabases, generateDatabaseName } from "@/lib/database/app-database-list"

export function AppDatabasesPage() {
  const queryClient = useQueryClient()
  const [view, setView] = useState<"grid" | "table">("table")
  const [search, setSearch] = useState("")
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => generateDatabaseName())
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
      setName(generateDatabaseName())
      setDescription("")
      toast.success("Database created.", { description: "A Default table is ready — add columns or start adding rows." })
    },
    onError: (e) => {
      toast.error(e instanceof Error ? e.message : "Could not create database.")
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (databaseId: string) => deleteAppDatabase(databaseId),
    onSuccess: (_data, databaseId) => {
      queryClient.removeQueries({ queryKey: queryKeys.appDatabase(databaseId) })
      queryClient.removeQueries({ queryKey: queryKeys.appDatabaseFolders(databaseId) })
      queryClient.invalidateQueries({ queryKey: queryKeys.appDatabases })
      queryClient.invalidateQueries({ queryKey: queryKeys.adminTables })
      queryClient.invalidateQueries({ queryKey: queryKeys.chatContext })
      notifyDeleted({ kind: "database" })
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
        cornerDecoration={<IntroCornerIcon icon={Layers2} />}
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
            <CreateAppDatabaseSheet
              open={open}
              setOpen={setOpen}
              name={name}
              setName={setName}
              description={description}
              setDescription={setDescription}
              createMutation={createMutation}
            />
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
        <AppDatabaseListGrid databases={filtered} canMutate={canMutate} deleteMutation={deleteMutation} />
      ) : (
        <AppDatabaseListTable databases={filtered} canMutate={canMutate} deleteMutation={deleteMutation} />
      )}
    </div>
  )
}

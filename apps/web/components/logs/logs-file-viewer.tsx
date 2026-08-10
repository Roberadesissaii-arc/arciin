"use client"

import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { FileText, RefreshCw, Terminal } from "lucide-react"

import { logLineClassName, stripAnsi } from "@/components/logs/log-line-styles"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsSelect } from "@/components/settings/settings-select"
import { getLogFiles, getLogTail } from "@/lib/api/logs"
import { queryKeys } from "@/lib/api/query-keys"
import { cn } from "@/lib/utils"
import { formatRelativeDate } from "@/lib/utils/format-date"
import { RelativeTime } from "@/components/shared/relative-time"

const TAIL_LINES = 200

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function LogsFileViewer() {
  const [selectedOverride, setSelectedOverride] = useState<string | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)

  const filesQuery = useQuery({
    queryKey: queryKeys.logFiles,
    queryFn: ({ signal }) => getLogFiles(signal),
    refetchInterval: autoRefresh ? 20_000 : false,
  })

  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data])
  const selected = selectedOverride ?? files[0]?.name ?? null

  const tailQuery = useQuery({
    queryKey: queryKeys.logTail(selected ?? "", TAIL_LINES),
    queryFn: ({ signal }) => getLogTail(selected!, TAIL_LINES, signal),
    enabled: Boolean(selected),
    refetchInterval: autoRefresh && selected ? 10_000 : false,
  })

  const activeFile = files.find((f) => f.name === selected)
  const lines = useMemo(
    () => (tailQuery.data?.lines ?? []).map((line) => stripAnsi(line)),
    [tailQuery.data?.lines],
  )

  return (
    <Card className="border-border bg-card shadow-sm">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-zinc-50 text-primary">
            <Terminal className="size-5" />
          </div>
          <div>
            <CardTitle className="text-foreground">Log output</CardTitle>
            <CardDescription className="text-zinc-600">
              Last {TAIL_LINES} lines · oldest entries drop automatically when a log exceeds ~1.8 MB.
            </CardDescription>
          </div>
          </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="border-border"
            onClick={() => {
              void filesQuery.refetch()
              if (selected) void tailQuery.refetch()
            }}
          >
            <RefreshCw className={cn("mr-1.5 size-3.5", tailQuery.isFetching && "animate-spin")} />
            Refresh
          </Button>
          <Button
            type="button"
            variant={autoRefresh ? "default" : "outline"}
            size="sm"
            onClick={() => setAutoRefresh((v) => !v)}
          >
            Auto {autoRefresh ? "on" : "off"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {filesQuery.isLoading ? (
          <Skeleton className="h-72 rounded-xl" />
        ) : filesQuery.isError ? (
          <div className="rounded-xl border border-amber-500/30 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-700">
            {filesQuery.error instanceof Error
              ? filesQuery.error.message
              : "Log files could not be listed. Ensure the API is running and the logs directory exists."}
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-zinc-50/50 px-6 py-12 text-center">
            <FileText className="size-8 text-zinc-400" />
            <p className="text-sm font-medium text-foreground">No log files yet</p>
            <p className="max-w-md text-[13px] text-zinc-600">
              The API writes to <span className="font-mono">api.log</span> when the server starts.
            </p>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <SettingsSelect
                aria-label="Log file"
                value={selected ?? files[0].name}
                options={files.map((f) => ({
                  value: f.name,
                  label: `${f.name} (${formatBytes(f.sizeBytes)})`,
                }))}
                onValueChange={setSelectedOverride}
              />
              {activeFile ? (
                <span className="text-xs text-zinc-500" suppressHydrationWarning>
                  {lines.length} lines · updated <RelativeTime value={activeFile.modifiedAt} />
                </span>
              ) : null}
            </div>

            {tailQuery.isLoading ? (
              <Skeleton className="h-72 rounded-xl" />
            ) : tailQuery.isError ? (
              <div className="rounded-xl border border-red-500/30 bg-zinc-50/80 px-4 py-3 text-sm text-zinc-800">
                {tailQuery.error instanceof Error
                  ? tailQuery.error.message
                  : "Could not read log file."}
              </div>
            ) : (
              <div
                className="scrollbar-hide max-h-[min(22rem,42vh)] overflow-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-[11px] leading-[1.65]"
                aria-label="Log tail"
                tabIndex={0}
              >
                {lines.length > 0 ? (
                  lines.map((line, index) => (
                    <div
                      key={`${index}-${line.slice(0, 24)}`}
                      className={cn("whitespace-pre", logLineClassName(line))}
                    >
                      {line || " "}
                    </div>
                  ))
                ) : (
                  <p className="text-zinc-500">(empty file)</p>
                )}
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  )
}

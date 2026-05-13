"use client"

import { useQuery } from "@tanstack/react-query"
import { ActivitySquare } from "lucide-react"

import { fetchApi } from "@/lib/api/client"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { Skeleton } from "@/components/ui/skeleton"
import type { HealthStatus } from "@/lib/types/models"

const healthLabels: Array<keyof Omit<HealthStatus, "version" | "timestamp">> = [
  "api",
  "database",
  "redis",
  "worker",
  "storage",
]

export function SystemHealthCard() {
  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  if (healthQuery.isLoading) {
    return <Skeleton className="h-56 rounded-3xl" />
  }

  if (healthQuery.isError) {
    return (
      <Card className="border-red-500/20 bg-red-500/5">
        <CardHeader>
          <CardTitle className="text-red-100">Health checks unavailable</CardTitle>
          <CardDescription className="text-red-200/80">
            {healthQuery.error instanceof Error
              ? healthQuery.error.message
              : "Could not load system health."}
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }

  const health = healthQuery.data

  if (!health) {
    return null
  }

  return (
    <Card className="relative overflow-hidden border-white/[0.1] bg-white/[0.02] shadow-none">
      <div className="pointer-events-none absolute inset-0" aria-hidden>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(255,75,51,0.14)_0%,rgba(9,9,11,0.04)_32%,transparent_58%)]" />
        <div className="absolute -top-28 left-1/2 aspect-[1.4] w-[min(100%,420px)] -translate-x-1/2 bg-[radial-gradient(ellipse_at_50%_30%,rgba(255,75,51,0.42)_0%,rgba(255,75,51,0.1)_45%,transparent_70%)] blur-[56px]" />
        <div className="absolute -top-16 right-[8%] h-[200px] w-[min(45%,240px)] bg-[radial-gradient(ellipse_at_center,rgba(255,120,90,0.2)_0%,transparent_68%)] blur-[40px]" />
      </div>

      <CardHeader className="relative z-10">
        <div className="flex items-center gap-3">
          <div className={dashboardStatIconShell}>
            <ActivitySquare className="size-5" />
          </div>
          <div>
            <CardTitle className="text-white">System health</CardTitle>
            <CardDescription className="text-zinc-400">
              Current service checks across the local stack.
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 grid gap-3 sm:grid-cols-2">
        {healthLabels.map((label) => {
          const value = health[label]
          const good = value === "online"

          return (
            <div
              key={label}
              className="flex items-center justify-between rounded-2xl border border-white/[0.08] bg-black/25 px-4 py-3 ring-1 ring-white/[0.04]"
            >
              <div className="text-sm capitalize text-zinc-300">{label}</div>
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <span
                  className={`size-2 rounded-full ${good ? "bg-emerald-400" : value === "unknown" ? "bg-zinc-500" : "bg-red-400"}`}
                />
                {value}
              </div>
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}

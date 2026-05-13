"use client"

import { formatRelativeDate } from "@/lib/utils/format-date"
import { useActivity } from "@/hooks/use-activity"

const STATS_COLORS = {
  total:    "#818cf8",
  uploads:  "#4ade80",
  folders:  "#60a5fa",
  lastEvent: "#f472b6",
}

export function ActivityHero() {
  const activityQuery = useActivity()
  const all = activityQuery.data ?? []

  const totalEvents  = all.length
  const uploadEvents = all.filter((e) => e.type.includes("asset") || e.type.includes("upload")).length
  const folderEvents = all.filter((e) => e.type.includes("folder")).length
  const lastEvent    = all[0] ? formatRelativeDate(all[0].createdAt) : "—"

  const stats = [
    { label: "Total Events", value: totalEvents,  color: STATS_COLORS.total    },
    { label: "File Events",  value: uploadEvents, color: STATS_COLORS.uploads  },
    { label: "Folder Events",value: folderEvents, color: STATS_COLORS.folders  },
    { label: "Last Event",   value: lastEvent,    color: STATS_COLORS.lastEvent },
  ]

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6"
      style={{ background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.08)" }}
    >
      {/* Subtle orange glow top-right */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{ background: "radial-gradient(ellipse at top right, rgba(255,79,18,0.07) 0%, transparent 60%)" }}
      />

      <div className="relative">
        {/* Title + subtitle */}
        <div>
          <p className="text-[15px] font-bold leading-snug text-white">
            Activity<span style={{ color: "#FF4F12" }}>.</span>
          </p>
          <p className="mt-0.5 text-[11px]" style={{ color: "rgba(255,255,255,0.4)" }}>
            Every action across your instance, recorded in real-time
          </p>
        </div>

        {/* Body */}
        <p className="mt-3 max-w-2xl text-[12px] leading-relaxed" style={{ color: "rgba(255,255,255,0.5)" }}>
          Every upload, folder change, classification, processing event, and operator action is logged here.
          Browse the full history, filter by page, and track exactly what your instance has done.
        </p>

        {/* Stats row */}
        <div
          className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 pt-3 sm:flex sm:flex-wrap sm:items-center sm:gap-6"
          style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}
        >
          {stats.map((s) => (
            <div key={s.label} className="flex min-w-0 items-center gap-2">
              <span className="text-[18px] font-bold tabular-nums text-white">{s.value}</span>
              <span className="text-[10px] font-medium leading-tight" style={{ color: s.color }}>
                {s.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"

import { PlanBadge } from "@/components/license/plan-badge"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/use-auth"
import { fetchApi } from "@/lib/api/client"
import { getGeneralSettings } from "@/lib/api/settings"
import { queryKeys } from "@/lib/api/query-keys"
import { useLicense } from "@/lib/license/use-license"
import { resolveUserGreeting, welcomeBackPhrase } from "@/lib/user/greeting"
import { cn } from "@/lib/utils"
import type { HealthStatus } from "@/lib/types/models"

const INTRO_SLIDES = [
  {
    image: "/assets/dashboard-intro/images.jpg?v=2",
    caption: "Photos and artwork land in Images with thumbnails ready.",
    accent: "Images · Vision · Ask AI",
  },
  {
    image: "/assets/dashboard-intro/videos.jpg?v=2",
    caption: "Videos route into your library — metadata and jobs stay local.",
    accent: "Videos · Processing · Plex-ready",
  },
  {
    image: "/assets/dashboard-intro/music.jpg?v=2",
    caption: "Audio collects in Music so playlists and players find it fast.",
    accent: "Music · Metadata · Playback",
  },
  {
    image: "/assets/dashboard-intro/libraries.jpg?v=2",
    caption: "Folders and libraries keep every file organized on your disk.",
    accent: "Libraries · Folders · Control",
  },
  {
    image: "/assets/dashboard-intro/command-center.jpg?v=2",
    caption: "Your private command center — storage, uploads, and live activity.",
    accent: "Overview · Storage · Activity",
  },
] as const

export function DashboardHomeIntro() {
  const authQuery = useAuth()
  const license = useLicense()
  const [active, setActive] = useState(0)
  const slide = INTRO_SLIDES[active]!

  const generalQuery = useQuery({
    queryKey: queryKeys.generalSettings,
    queryFn: ({ signal }) => getGeneralSettings(signal),
  })

  const healthQuery = useQuery({
    queryKey: ["health"],
    queryFn: () => fetchApi<HealthStatus>("/health"),
    refetchInterval: 30_000,
  })

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((i) => (i + 1) % INTRO_SLIDES.length)
    }, 6500)
    return () => window.clearInterval(timer)
  }, [])

  const identityLoading = authQuery.isLoading
  const serverUnreachable = healthQuery.isError || authQuery.isError

  const greeting = resolveUserGreeting({
    isLoading: identityLoading,
    isOffline: serverUnreachable || authQuery.isError || !authQuery.data?.user,
    fullName: authQuery.data?.user.name,
  })
  const welcomeName = welcomeBackPhrase(greeting)
  const instanceName = generalQuery.data?.instanceName ?? "Your instance"

  const subtitle = identityLoading ? null : welcomeName
    ? `${instanceName} · welcome back, ${welcomeName}`
    : `${instanceName} · welcome back`

  return (
    <section
      className={cn(
        "relative shrink-0 overflow-hidden rounded-3xl border border-zinc-200/90 bg-white",
        "shadow-sm ring-1 ring-inset ring-zinc-200/60",
        "min-h-[15rem] sm:min-h-[15.75rem] lg:min-h-[16.25rem]",
      )}
    >
      {/* Left copy */}
      <div className="relative z-10 flex max-w-full flex-col justify-center px-5 py-5 sm:px-7 sm:py-6 lg:max-w-[46%] lg:px-8 lg:py-6">
        <div className="flex flex-wrap items-start justify-between gap-3 lg:block">
          <div className="min-w-0">
            <h2 className="font-heading text-[1.5rem] font-semibold tracking-tight text-zinc-900 sm:text-[1.7rem]">
              Arciin
              <span className="text-primary">.</span>
            </h2>
            {identityLoading ? (
              <Skeleton className="mt-1.5 h-4 w-56 max-w-full rounded-md" />
            ) : (
              <p className="mt-1 text-sm font-medium text-zinc-500">{subtitle}</p>
            )}
          </div>
          {/* Mobile / tablet: badge sits with title; desktop badge lives on the image */}
          {license.ready ? (
            <Link
              href="/settings?tab=license"
              aria-label="View license and plan"
              className="inline-flex shrink-0 transition-opacity hover:opacity-85 lg:hidden"
            >
              <PlanBadge plan={license.plan} />
            </Link>
          ) : null}
        </div>

        <p className="mt-3 max-w-[36ch] text-[13px] leading-relaxed text-zinc-600 sm:mt-3.5 sm:text-sm sm:leading-relaxed">
          Your private command center for files, libraries, and background work on this
          server. Drop files anywhere — Arciin classifies them, stores metadata here, and
          keeps activity visible in real time.
        </p>

        <span
          className="mt-4 inline-block h-0.5 w-16 rounded-full bg-primary sm:mt-5 sm:w-[4.5rem]"
          aria-hidden
        />
      </div>

      {/* Right media — 45° diagonal cut on large screens */}
      <div
        className={cn(
          "relative h-40 w-full overflow-hidden sm:h-48",
          "lg:absolute lg:inset-y-0 lg:right-0 lg:h-auto lg:w-[58%]",
          "lg:[clip-path:polygon(16%_0,100%_0,100%_100%,0%_100%)]",
        )}
      >
        <div className="absolute inset-0">
          {INTRO_SLIDES.map((item, index) => (
            <Image
              key={item.image}
              src={item.image}
              alt=""
              fill
              unoptimized
              priority={index === 0}
              className={cn(
                "object-cover object-center transition-opacity duration-700",
                index === active ? "opacity-100" : "opacity-0",
              )}
              sizes="(max-width: 1024px) 100vw, 58vw"
            />
          ))}

          <div
            className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/75 via-black/25 to-black/10"
            aria-hidden
          />

          {license.ready ? (
            <Link
              href="/settings?tab=license"
              aria-label="View license and plan"
              className="absolute right-4 top-4 z-20 hidden transition-opacity hover:opacity-90 lg:inline-flex"
            >
              <PlanBadge plan={license.plan} />
            </Link>
          ) : null}

          <div className="absolute inset-x-0 bottom-0 z-10 flex flex-col gap-3 px-5 pb-4 pt-10 sm:px-6 sm:pb-5 lg:pl-14">
            <div className="max-w-md">
              <p className="text-[13px] font-medium leading-snug text-white sm:text-sm">
                {slide.caption}
              </p>
              <p className="mt-1 text-[11px] font-semibold tracking-wide text-primary sm:text-[12px]">
                {slide.accent}
              </p>
            </div>

            <div className="flex items-center gap-1.5">
              {INTRO_SLIDES.map((item, index) => (
                <button
                  key={item.image}
                  type="button"
                  aria-label={`Show slide ${index + 1}`}
                  aria-current={index === active}
                  onClick={() => setActive(index)}
                  className={cn(
                    "h-1 rounded-full transition-all",
                    index === active
                      ? "w-6 bg-primary"
                      : "w-1.5 bg-white/45 hover:bg-white/70",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

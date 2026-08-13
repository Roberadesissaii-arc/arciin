"use client"

import { useCallback, useState } from "react"

import { DashboardPreview } from "@/components/auth/login-hero-showcase"
import { cn } from "@/lib/utils"

/**
 * Left setup hero:
 * - Same dashboard preview placement/scale/mask as {@link LoginHeroShowcase}
 * - Original claim copy + pill dots at the bottom
 */
const slides = [
  {
    title: (
      <>
        Claim your instance.
        <span className="block text-white/50">Keep it on your server.</span>
      </>
    ),
    body: "This server is private and has not been configured yet. Create the first owner account, choose a storage path, and start with local defaults.",
  },
  {
    title: (
      <>
        Your files stay local.
        <span className="block text-white/50">Runs only on this machine.</span>
      </>
    ),
    body: "Everything stays on this machine: pick your folder and sign in locally. No hosted identity or shared cloud signup.",
  },
  {
    title: (
      <>
        One claim, then it locks.
        <span className="block text-white/50">First-run never repeats.</span>
      </>
    ),
    body: "The first successful claim creates the owner and closes first-run for good. Only sign-in for people you add later.",
  },
] as const

export function SetupHeroShowcase() {
  const [index, setIndex] = useState(
    () => Math.floor(Math.random() * slides.length),
  )

  const goTo = useCallback((next: number) => {
    setIndex(Math.min(slides.length - 1, Math.max(0, next)))
  }, [])

  const slide = slides[index]

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Exact login preview geometry: left bleed, scale, fade mask */}
      <div
        aria-hidden
        className="absolute left-0 top-2 z-0 w-[118%] origin-top-left scale-[0.84] opacity-85"
        style={{
          maskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to bottom, black 52%, black 72%, rgba(0,0,0,0.65) 86%, transparent 100%)",
        }}
      >
        <DashboardPreview />
      </div>

      {/* Original bottom copy + dots */}
      <div className="relative z-10 mt-auto max-w-md space-y-4 pt-6">
        <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
          Your server, your control.
        </span>
        <div className="space-y-3">
          <h1
            key={index}
            className="text-4xl font-semibold tracking-tight text-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 md:text-[2.45rem] md:leading-[1.12]"
          >
            {slide.title}
          </h1>
          <p
            key={`${index}-body`}
            className="text-[15px] leading-7 text-white/60 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
          >
            {slide.body}
          </p>
        </div>
        <div
          className="flex items-center gap-2 pt-1"
          role="tablist"
          aria-label="Setup highlights"
        >
          {slides.map((_, i) => {
            const active = i === index
            return (
              <button
                key={i}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={`Show slide ${i + 1} of ${slides.length}`}
                className={cn(
                  "h-[7px] rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
                  active ? "w-[22px] bg-white" : "w-[7px] bg-white/30 hover:bg-white/50",
                )}
                onClick={() => goTo(i)}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

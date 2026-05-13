"use client"

import { useCallback, useEffect, useState } from "react"

import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

const slides = [
  {
    title: (
      <>
        Access your instance.
        <span className="block text-white/45">Same server you configured.</span>
      </>
    ),
    body: "Sign in with the account that belongs to this Arciin install. Libraries, uploads, and activity all stay on this machine.",
  },
  {
    title: (
      <>
        Sessions stay local.
        <span className="block text-white/45">No hosted identity layer.</span>
      </>
    ),
    body: "Passwords are verified here; sessions use httpOnly cookies. There is no public signup or shared cloud login for this instance.",
  },
  {
    title: (
      <>
        Your control room.
        <span className="block text-white/45">Files, jobs, settings.</span>
      </>
    ),
    body: "After sign-in you pick up where you left off: folders, media libraries, API keys, and integrations — all scoped to this host.",
  },
] as const

export function LoginHeroCopy() {
  const [index, setIndex] = useState(0)

  useEffect(() => {
    const id = window.requestAnimationFrame(() => {
      setIndex(Math.floor(Math.random() * slides.length))
    })
    return () => window.cancelAnimationFrame(id)
  }, [])

  const goTo = useCallback((next: number) => {
    setIndex(Math.min(slides.length - 1, Math.max(0, next)))
  }, [])

  const slide = slides[index]

  return (
    <div className="max-w-md space-y-4">
      <Badge className="border border-white/10 bg-white/[0.05] px-3 py-1 text-[#FFB39C] hover:bg-white/[0.05]">
        Your server, your control.
      </Badge>
      <div className="min-h-[18.5rem] space-y-3 sm:min-h-[17.5rem]">
        <h1
          key={index}
          className="min-h-[5.25rem] text-4xl font-semibold tracking-tight text-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 md:min-h-[5.75rem] md:text-5xl"
        >
          {slide.title}
        </h1>
        <p
          key={`${index}-body`}
          className="min-h-[5.25rem] text-base leading-7 text-zinc-400 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
        >
          {slide.body}
        </p>
      </div>
      <div
        className="flex items-center gap-2 pt-1"
        role="tablist"
        aria-label="Sign-in highlights"
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
                "h-2.5 w-2.5 rounded-full transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                active
                  ? "scale-110 bg-white shadow-sm"
                  : "bg-white/25 hover:bg-white/40"
              )}
              onClick={() => goTo(i)}
            />
          )
        })}
      </div>
    </div>
  )
}

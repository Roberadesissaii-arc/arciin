"use client"

import { useCallback, useEffect, useState } from "react"

import { cn } from "@/lib/utils"

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

export function SetupHeroCopy() {
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
      <span className="inline-flex items-center rounded-full border border-white/25 bg-white/10 px-3 py-1 text-[11px] font-semibold text-white/90">
        Your server, your control.
      </span>
      <div className="min-h-[16rem] space-y-3 sm:min-h-[15rem]">
        <h1
          key={index}
          className="min-h-[5.25rem] text-4xl font-semibold tracking-tight text-white motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-1 motion-safe:duration-300 md:min-h-[5.75rem] md:text-[2.6rem] md:leading-[1.12]"
        >
          {slide.title}
        </h1>
        <p
          key={`${index}-body`}
          className="min-h-[5.25rem] text-[15px] leading-7 text-white/60 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:duration-300"
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
                active ? "w-[22px] bg-white" : "w-[7px] bg-white/30 hover:bg-white/50"
              )}
              onClick={() => goTo(i)}
            />
          )
        })}
      </div>
    </div>
  )
}

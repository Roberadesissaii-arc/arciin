"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight } from "lucide-react"

import { cn } from "@/lib/utils"

const useIsoLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect

export interface CoverflowSlide {
  src: string
  alt: string
  title?: string
  subtitle?: string
  meta?: { label: string; value: string }[]
}

export interface CoverflowCarouselProps {
  slides: CoverflowSlide[]
  /** Degrees the first neighbour tilts. */
  rotate?: number
  /** How far the first neighbour recedes, as a fraction of card width. */
  depth?: number
  /** Viewer distance as a multiple of card width — smaller is a wider lens. */
  perspective?: number
  /** Exponent on distance. Below 1 the rake eases off as cards travel out. */
  falloff?: number
  /** Opacity lost per step from the centre. */
  fade?: number
  /** Any CSS length. Everything else is derived from it, so the rake scales. */
  cardWidth?: string
  /** Space between cards, as a fraction of card width. */
  gap?: number
  loop?: boolean
  showCaption?: boolean
  showPagination?: boolean
  showNavigation?: boolean
  /** Names the carousel for assistive tech. */
  label?: string
  className?: string
  cardClassName?: string
  /** Fires when the centre slide is activated (click / Enter). */
  onSlideActivate?: (index: number) => void
  /** Controlled / notified when the settled centre index changes. */
  onSelectedChange?: (index: number) => void
}

export function CoverflowCarousel({
  slides,
  rotate = 44,
  depth = 0.6,
  perspective = 3,
  falloff = 0.56,
  fade = 0.1,
  cardWidth = "clamp(148px, 22vw, 260px)",
  gap = 0.05,
  loop = true,
  showCaption = false,
  showPagination = false,
  showNavigation = false,
  label = "Cover carousel",
  className,
  cardClassName,
  onSlideActivate,
  onSelectedChange,
}: CoverflowCarouselProps) {
  const count = slides.length

  const frameRef = React.useRef<HTMLDivElement>(null)
  const cardRefs = React.useRef<(HTMLDivElement | null)[]>([])
  /** Fractional card index at the centre. The single source of truth. */
  const posRef = React.useRef(0)
  /** Where the current settle is headed. */
  const targetRef = React.useRef(0)
  const widthRef = React.useRef(0)
  const rafRef = React.useRef<number | null>(null)
  const dragRef = React.useRef<{
    id: number
    x: number
    pos: number
    v: number
    t: number
  } | null>(null)
  const draggedRef = React.useRef(false)

  const [selected, setSelected] = React.useState(0)

  const setSelectedIndex = React.useCallback(
    (index: number) => {
      setSelected((prev) => {
        if (prev === index) return prev
        onSelectedChange?.(index)
        return index
      })
    },
    [onSelectedChange],
  )

  /** Nearest whole card, folded back into 0..count-1. */
  const indexAt = React.useCallback(
    (pos: number) => ((Math.round(pos) % count) + count) % count,
    [count],
  )

  // Paint straight to the DOM — avoid re-rendering every frame.
  const paint = React.useCallback(() => {
    const width = widthRef.current
    if (!width || count === 0) return
    const pitch = width * (1 + gap)
    const pos = posRef.current

    cardRefs.current.forEach((card, index) => {
      if (!card) return

      let offset = index - pos
      if (loop) {
        offset = ((offset % count) + count) % count
        if (offset > count / 2) offset -= count
      }

      const distance = Math.abs(offset)
      const ramp = Math.pow(distance, falloff)
      const tilt = Math.min(rotate * ramp, 82) * Math.sign(offset)

      card.style.transform =
        `translateX(calc(-50% + ${offset * pitch}px)) ` +
        `translateZ(${-depth * width * ramp}px) rotateY(${-tilt}deg)`

      const edge = loop ? Math.min(1, Math.max(0, count / 2 - distance)) : 1
      card.style.opacity = String(Math.max(0, 1 - fade * distance) * edge)
      card.style.zIndex = String(100 - Math.round(distance))
    })
  }, [count, depth, fade, falloff, gap, loop, rotate])

  const settle = React.useCallback(
    (target: number) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      targetRef.current = target
      setSelectedIndex(indexAt(target))

      const step = () => {
        const remaining = target - posRef.current
        if (Math.abs(remaining) < 0.0004) {
          posRef.current = target
          paint()
          rafRef.current = null
          return
        }
        posRef.current += remaining * 0.16
        paint()
        rafRef.current = requestAnimationFrame(step)
      }
      rafRef.current = requestAnimationFrame(step)
    },
    [indexAt, paint, setSelectedIndex],
  )

  const clamp = React.useCallback(
    (pos: number) => (loop ? pos : Math.max(0, Math.min(count - 1, pos))),
    [count, loop],
  )

  const goTo = React.useCallback(
    (index: number) => {
      const target = loop
        ? index + Math.round((targetRef.current - index) / count) * count
        : index
      settle(clamp(target))
    },
    [clamp, count, loop, settle],
  )

  const nudge = React.useCallback(
    (by: number) => settle(clamp(Math.round(targetRef.current) + by)),
    [clamp, settle],
  )

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    targetRef.current = posRef.current
    draggedRef.current = false
    dragRef.current = {
      id: event.pointerId,
      x: event.clientX,
      pos: posRef.current,
      v: 0,
      t: performance.now(),
    }
  }

  /**
   * Activation happens here, not on the card's own click.
   *
   * The track calls setPointerCapture on pointerdown so a drag keeps tracking
   * outside the element. A captured pointer delivers its click to the capturing
   * element, so the click listener on the card never fired — the image looked
   * dead and only the caption below it worked. Reading the card out of the
   * pointerup target restores it without giving up capture, which the drag
   * needs.
   */
  const activateFromPointer = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!onSlideActivate || draggedRef.current) return
    const target = event.target as HTMLElement | null
    const card = target?.closest?.("[data-cf-index]") as HTMLElement | null
    if (!card) return
    const index = Number(card.dataset.cfIndex)
    if (!Number.isInteger(index)) return
    // One press: bring the card forward and run the action.
    if (indexAt(posRef.current) !== index) goTo(index)
    onSlideActivate(index)
  }

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return

    const pitch = widthRef.current * (1 + gap)
    if (!pitch) return

    if (Math.abs(event.clientX - drag.x) > 4) {
      draggedRef.current = true
    }

    const now = performance.now()
    const previous = posRef.current
    posRef.current = clamp(drag.pos - (event.clientX - drag.x) / pitch)
    drag.v = ((posRef.current - previous) / Math.max(now - drag.t, 1)) * 1000
    drag.t = now

    const index = indexAt(posRef.current)
    if (index !== selected) setSelectedIndex(index)
    paint()
  }

  const endDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag || drag.id !== event.pointerId) return
    dragRef.current = null
    const carried = Math.max(-2, Math.min(2, drag.v * 0.18))
    settle(clamp(Math.round(posRef.current + carried)))
  }

  useIsoLayoutEffect(() => {
    const frame = frameRef.current
    if (!frame) return

    const measure = () => {
      const card = cardRefs.current[0]
      if (!card) return
      widthRef.current = card.offsetWidth
      paint()
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(frame)
    return () => observer.disconnect()
  }, [paint])

  React.useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    },
    [],
  )

  if (count === 0) return null

  const active = slides[selected]

  return (
    <div
      className={cn("w-full", className)}
      style={{ ["--cf-card" as string]: cardWidth }}
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
    >
      <div className="relative">
        <div
          ref={frameRef}
          tabIndex={0}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => {
            endDrag(event)
            activateFromPointer(event)
          }}
          onPointerCancel={endDrag}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft") {
              event.preventDefault()
              nudge(-1)
            } else if (event.key === "ArrowRight") {
              event.preventDefault()
              nudge(1)
            } else if (event.key === "Enter" || event.key === " ") {
              if (onSlideActivate) {
                event.preventDefault()
                onSlideActivate(selected)
              }
            }
          }}
          className="cursor-grab overflow-hidden py-10 outline-none ring-ring focus-visible:ring-2 active:cursor-grabbing"
          style={{
            perspective: `calc(var(--cf-card) * ${perspective})`,
            touchAction: "pan-y",
          }}
        >
          <div
            className="relative select-none"
            style={{
              height: "var(--cf-card)",
              transformStyle: "preserve-3d",
            }}
          >
            {slides.map((slide, index) => (
              <div
                key={`${slide.src}-${index}`}
                ref={(node) => {
                  cardRefs.current[index] = node
                }}
                role="group"
                aria-roledescription="slide"
                aria-label={`${index + 1} of ${count}${slide.title ? `: ${slide.title}` : ""}${
                  onSlideActivate ? ". Activate to use this quick start." : ""
                }`}
                className={cn(
                  "group/card absolute left-1/2 top-0 aspect-square overflow-hidden rounded-2xl bg-muted shadow-xl will-change-transform",
                  "ring-1 ring-black/10 transition-[box-shadow,filter] duration-300 ease-out",
                  "hover:shadow-[0_18px_40px_-18px_rgba(24,24,27,0.55)] hover:ring-[#FF4F12]/35",
                  onSlideActivate && "cursor-pointer",
                  cardClassName,
                )}
                data-cf-index={index}
                style={{ width: "var(--cf-card)" }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={slide.src}
                  alt={slide.alt}
                  draggable={false}
                  className="h-full w-full select-none object-cover transition-transform duration-500 ease-out group-hover/card:scale-[1.045]"
                />
                {/* Soft lift wash — stays subtle so art stays primary */}
                <div
                  className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/5 opacity-0 transition-opacity duration-300 group-hover/card:opacity-100"
                  aria-hidden
                />
              </div>
            ))}
          </div>
        </div>

        {showNavigation && (
          <>
            <button
              type="button"
              aria-label="Previous slide"
              onClick={() => nudge(-1)}
              className="absolute left-3 top-1/2 z-[200] -translate-y-1/2 rounded-full bg-background/70 p-2 text-foreground backdrop-blur transition hover:bg-background"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              aria-label="Next slide"
              onClick={() => nudge(1)}
              className="absolute right-3 top-1/2 z-[200] -translate-y-1/2 rounded-full bg-background/70 p-2 text-foreground backdrop-blur transition hover:bg-background"
            >
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
      </div>

      {showCaption && active?.title && (
        <div
          key={selected}
          className="mt-2 flex flex-col items-center px-6 duration-300 animate-in fade-in"
        >
          <p className="text-[15px] font-semibold tracking-tight text-foreground">
            {active.title}
          </p>
          {active.subtitle && (
            <p className="mt-1 max-w-md text-center text-[13px] text-muted-foreground">
              {active.subtitle}
            </p>
          )}
          {active.meta && active.meta.length > 0 && (
            <dl className="mt-6 w-full max-w-[230px] text-[12px]">
              {active.meta.map((row) => (
                <div key={row.label} className="flex justify-between py-[5px]">
                  <dt className="text-muted-foreground">{row.label}</dt>
                  <dd className="font-medium text-foreground">{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}

      {showPagination && (
        <div className="mt-6 flex items-center justify-center gap-2">
          {slides.map((_, index) => (
            <button
              key={index}
              type="button"
              aria-label={`Go to slide ${index + 1}`}
              aria-current={index === selected}
              onClick={() => goTo(index)}
              className={cn(
                "size-2 rounded-full bg-foreground transition-opacity",
                index === selected ? "opacity-100" : "opacity-30",
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}

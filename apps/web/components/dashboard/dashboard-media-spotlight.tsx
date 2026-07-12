"use client"

import Image from "next/image"
import Link from "next/link"
import { useEffect, useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { cn } from "@/lib/utils"

const SLIDES = [
  {
    title: "Images",
    description:
      "Photos and artwork land in your Images library with thumbnails and metadata.",
    image: "/assets/library-placeholders/images.webp",
    href: "/images",
    cta: "Browse images",
  },
  {
    title: "Videos",
    description:
      "Video files route to Videos — ready for Plex folders and future streaming hooks.",
    image: "/assets/library-placeholders/videos.webp",
    href: "/videos",
    cta: "Browse videos",
  },
  {
    title: "Documents",
    description:
      "PDFs and office files stay searchable in Documents with previews where supported.",
    image: "/assets/library-placeholders/documents.webp",
    href: "/documents",
    cta: "Browse documents",
  },
  {
    title: "Music",
    description:
      "Audio uploads collect in Music so playlists and players can find them fast.",
    image: "/assets/library-placeholders/music.webp",
    href: "/music",
    cta: "Browse music",
  },
] as const

export function DashboardMediaSpotlight({ className }: { className?: string }) {
  const [active, setActive] = useState(0)
  const slide = SLIDES[active]!

  useEffect(() => {
    const timer = window.setInterval(() => {
      setActive((i) => (i + 1) % SLIDES.length)
    }, 8000)
    return () => window.clearInterval(timer)
  }, [])

  return (
    <Card
      className={cn(
        "flex h-full min-h-[18rem] flex-col overflow-hidden border-zinc-200/80 bg-card shadow-sm sm:min-h-[20rem] lg:min-h-0",
        className,
      )}
    >
      <CardHeader className="space-y-1 border-b border-zinc-100/80 pb-4">
        <div className="min-w-0 space-y-0.5 border-l-2 border-primary pl-3">
          <CardTitle className="font-heading text-base font-semibold tracking-tight text-zinc-900">
            Media library
          </CardTitle>
          <CardDescription className="text-sm text-zinc-600">
            Browse your default libraries on this server.
          </CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col px-4 py-3 sm:px-5">
        <div className="relative min-h-[11rem] flex-1 overflow-hidden rounded-2xl border border-zinc-800/60 bg-zinc-950 sm:min-h-[12rem] md:min-h-[14rem] lg:min-h-[10rem]">
          <Image
            src={slide.image}
            alt=""
            fill
            unoptimized
            className="object-cover object-right"
            sizes="(max-width: 768px) 100vw, (max-width: 1024px) 50vw, 33vw"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/95 via-zinc-950/70 to-zinc-950/20 lg:from-zinc-950/92 lg:via-zinc-950/55 lg:to-zinc-950/15" />

          <div className="absolute inset-0 flex flex-col justify-between p-3.5 sm:p-4 lg:p-5">
            <div className="max-w-full pr-2 sm:max-w-[85%] lg:max-w-[72%] xl:max-w-[58%]">
              <h3 className="font-heading text-sm font-semibold tracking-tight text-white sm:text-base lg:text-lg">
                {slide.title}
              </h3>
              <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-zinc-300 sm:mt-1.5 sm:text-[12px] lg:line-clamp-none lg:text-[13px]">
                {slide.description}
              </p>
              <Button
                asChild
                size="sm"
                variant="ghost"
                className={cn(
                  "mt-2.5 h-8 rounded-full border border-white/25 bg-white/10 px-3.5 text-xs font-semibold text-white",
                  "shadow-none backdrop-blur-md transition-colors",
                  "hover:border-zinc-300/40 hover:bg-zinc-400/30 hover:text-white",
                  "sm:mt-3",
                )}
              >
                <Link href={slide.href}>{slide.cta}</Link>
              </Button>
            </div>

            <div className="flex items-center justify-center gap-2 pt-2">
              {SLIDES.map((item, index) => (
                <button
                  key={item.title}
                  type="button"
                  aria-label={`Show ${item.title}`}
                  onClick={() => setActive(index)}
                  className={cn(
                    "size-2 rounded-full transition-all",
                    index === active
                      ? "w-5 bg-white"
                      : "bg-white/35 hover:bg-white/55",
                  )}
                />
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

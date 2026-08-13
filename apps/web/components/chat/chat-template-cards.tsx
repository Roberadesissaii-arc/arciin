"use client"

import Link from "next/link"
import { useState } from "react"
import { ArrowRight } from "lucide-react"

import {
  CoverflowCarousel,
  type CoverflowSlide,
} from "@/components/ui/coverflow-carousel"
import { cn } from "@/lib/utils"

export type ChatTemplate = {
  id: string
  title: string
  description: string
  linkText: string
  imageSrc: string
  /** Pre-filled user message sent when the card is chosen. */
  prompt: string
}

/** Starter prompts for empty chat — related to Arciin libraries & API. */
export const CHAT_TEMPLATES: ChatTemplate[] = [
  {
    id: "api",
    title: "Use the REST API",
    description: "List libraries, upload files, or call endpoints with real instance context.",
    linkText: "Start",
    imageSrc: "/assets/chat-templates/api.jpg?v=8",
    prompt:
      "Help me use the Arciin REST API on this instance. Show practical examples (curl or Python) for listing libraries and uploading a file. Use real library ids from my server when you can.",
  },
  {
    id: "find-files",
    title: "Find files in my libraries",
    description: "Search Videos, Images, Music, and Documents with library tools.",
    linkText: "Search",
    imageSrc: "/assets/chat-templates/find-files.jpg?v=8",
    prompt:
      "Help me find files in my Arciin libraries. Ask what I'm looking for, then use library tools if available to search and point me to the right folders.",
  },
  {
    id: "organize",
    title: "Organize my media",
    description: "Suggest folders and routing for videos, photos, and music.",
    linkText: "Organize",
    imageSrc: "/assets/chat-templates/organize.jpg?v=8",
    prompt:
      "Help me organize media on this Arciin server. Suggest a simple folder structure for Videos, Images, and Music, and how uploads should be classified.",
  },
  {
    id: "summarize",
    title: "Work with documents",
    description: "Summarize PDFs, notes, and text already stored in Documents.",
    linkText: "Open",
    imageSrc: "/assets/chat-templates/documents.jpg?v=8",
    prompt:
      "I want to work with documents in my Arciin library. Explain how to open or point you at a PDF or text file, and summarize what you can do once a file is in context.",
  },
]

function templatesToSlides(templates: ChatTemplate[]): CoverflowSlide[] {
  return templates.map((t) => ({
    src: t.imageSrc,
    alt: t.title,
    title: t.title,
    subtitle: t.description,
  }))
}

export function ChatTemplateCards({
  onSelect,
  disabled,
}: {
  onSelect: (template: ChatTemplate) => void
  disabled?: boolean
}) {
  const [selected, setSelected] = useState(0)
  const slides = templatesToSlides(CHAT_TEMPLATES)
  const active = CHAT_TEMPLATES[selected] ?? CHAT_TEMPLATES[0]!

  const activate = (index: number) => {
    if (disabled) return
    const template = CHAT_TEMPLATES[index]
    if (template) onSelect(template)
  }

  return (
    <div className="flex w-full max-w-3xl flex-col items-center sm:max-w-4xl">
      <div className="mb-1 text-center">
        <h2 className="font-heading text-base font-semibold tracking-tight text-foreground sm:text-lg">
          Quick starts
        </h2>
        <p className="mt-1 text-[13px] text-muted-foreground">
          Swipe the deck — or type your own message below.
        </p>
      </div>

      <CoverflowCarousel
        slides={slides}
        showCaption
        showPagination
        showNavigation
        label="Chat quick starts"
        cardWidth="clamp(132px, 28vw, 220px)"
        className="w-full"
        cardClassName="ring-1 ring-black/5"
        onSelectedChange={setSelected}
        onSlideActivate={activate}
      />

      <div className="mt-4 flex flex-col items-center gap-2">
        {disabled ? (
          <Link
            href="/settings?tab=license"
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border border-zinc-200 bg-zinc-50 px-4 py-2",
              "text-[13px] font-semibold text-zinc-600 transition-colors",
              "hover:border-orange-200 hover:bg-orange-50 hover:text-[#FF4F12]",
            )}
          >
            Upgrade to use templates
            <ArrowRight className="size-3.5" aria-hidden />
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => activate(selected)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl bg-[#FF4F12] px-4 py-2",
              "text-[13px] font-semibold text-white shadow-sm transition-colors",
              "hover:bg-[#FF6A33]",
            )}
          >
            {active.linkText}
            <ArrowRight className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  )
}

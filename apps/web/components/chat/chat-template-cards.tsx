"use client"

import { CardGrid, type CardGridItem } from "@/components/ui/card-grid"

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
    imageSrc: "/assets/chat-templates/api.jpg?v=7",
    prompt:
      "Help me use the Arciin REST API on this instance. Show practical examples (curl or Python) for listing libraries and uploading a file. Use real library ids from my server when you can.",
  },
  {
    id: "find-files",
    title: "Find files in my libraries",
    description: "Search Videos, Images, Music, and Documents with library tools.",
    linkText: "Search",
    imageSrc: "/assets/chat-templates/find-files.jpg?v=7",
    prompt:
      "Help me find files in my Arciin libraries. Ask what I'm looking for, then use library tools if available to search and point me to the right folders.",
  },
  {
    id: "organize",
    title: "Organize my media",
    description: "Suggest folders and routing for videos, photos, and music.",
    linkText: "Organize",
    imageSrc: "/assets/chat-templates/organize.jpg?v=7",
    prompt:
      "Help me organize media on this Arciin server. Suggest a simple folder structure for Videos, Images, and Music, and how uploads should be classified.",
  },
  {
    id: "summarize",
    title: "Work with documents",
    description: "Summarize PDFs, notes, and text already stored in Documents.",
    linkText: "Open",
    imageSrc: "/assets/chat-templates/documents.jpg?v=7",
    prompt:
      "I want to work with documents in my Arciin library. Explain how to open or point you at a PDF or text file, and summarize what you can do once a file is in context.",
  },
]

export function ChatTemplateCards({
  onSelect,
  disabled,
}: {
  onSelect: (template: ChatTemplate) => void
  disabled?: boolean
}) {
  const items: CardGridItem[] = CHAT_TEMPLATES.map((t) => ({
    id: t.id,
    imageSrc: t.imageSrc,
    title: t.title,
    description: t.description,
    linkText: t.linkText,
    onSelect: disabled ? undefined : () => onSelect(t),
  }))

  const displayItems: CardGridItem[] = disabled
    ? CHAT_TEMPLATES.map((t) => ({
        id: t.id,
        imageSrc: t.imageSrc,
        title: t.title,
        description: t.description,
        linkText: t.linkText,
        linkHref: "/settings?tab=license",
      }))
    : items

  return (
    <CardGrid
      title="Quick starts"
      subtitle="Pick a card to jump in — or type your own message below."
      items={displayItems}
      columns={4}
      compact
      className="w-full max-w-3xl sm:max-w-4xl"
    />
  )
}

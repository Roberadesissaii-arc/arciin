"use client"

import { ChevronDown } from "lucide-react"

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import { cn } from "@/lib/utils"

/** Collapsed tips so setup / settings pages stay compact on one screen. */
export function StorageInstallNotesCollapsible({
  notes,
  className,
}: {
  notes: string[]
  className?: string
}) {
  if (!notes.length) return null

  if (notes.length === 1) {
    return (
      <p className={cn("text-[11px] leading-relaxed text-zinc-500", className)}>
        {notes[0]}
      </p>
    )
  }

  return (
    <Collapsible className={className}>
      <CollapsibleTrigger
        type="button"
        className="group flex w-full items-center gap-1.5 text-left text-[11px] text-zinc-500"
      >
        <ChevronDown
          className={cn(
            "size-3 shrink-0 transition-transform",
            "group-data-[state=open]:rotate-180",
          )}
        />
        <span>
          {notes.length} storage tips
          <span className="text-zinc-600 group-data-[state=closed]:underline">
            {" "}
            — view
          </span>
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ul className="mt-1.5 space-y-1 pl-4 text-[11px] leading-relaxed text-zinc-500">
          {notes.map((note) => (
            <li key={note} className="list-disc">
              {note}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Drop install notes that duplicate the unmounted-drives panel. */
export function filterStorageInstallNotes(notes: string[]) {
  return notes.filter((note) => !/^Unmounted drive\(s\):/i.test(note))
}

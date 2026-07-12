"use client"

import type { LucideIcon } from "lucide-react"
import { LayoutGrid, MessageSquare, Palette } from "lucide-react"

import { cn } from "@/lib/utils"

export type PersonalizationSection = "general" | "theme" | "toasters"

export const PERSONALIZATION_SECTIONS: {
  id: PersonalizationSection
  label: string
  icon: LucideIcon
}[] = [
  { id: "general", label: "General", icon: LayoutGrid },
  { id: "theme", label: "Appearance", icon: Palette },
  { id: "toasters", label: "Toasters", icon: MessageSquare },
]

export function PersonalizationSubNav({
  section,
  onSectionChange,
}: {
  section: PersonalizationSection
  onSectionChange: (section: PersonalizationSection) => void
}) {
  return (
    <nav
      className="personalization-subnav relative overflow-hidden rounded-2xl border border-border/80 bg-card p-1.5 shadow-sm"
      aria-label="Personalization sections"
    >
      <div className="relative flex flex-wrap gap-1">
        {PERSONALIZATION_SECTIONS.map(({ id, label, icon: Icon }) => {
          const active = section === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => onSectionChange(id)}
              className={cn(
                "flex min-w-[7.5rem] flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-[13px] font-semibold transition-all",
                active
                  ? "personalization-subnav-active text-foreground shadow-sm"
                  : "text-zinc-600 hover:bg-white/60 hover:text-zinc-900",
              )}
            >
              <Icon className={cn("size-4 shrink-0", active && "text-primary")} />
              {label}
            </button>
          )
        })}
      </div>
    </nav>
  )
}

export function personalizationSectionFromParam(
  value: string | null,
): PersonalizationSection {
  if (value === "theme" || value === "toasters" || value === "general") return value
  return "general"
}

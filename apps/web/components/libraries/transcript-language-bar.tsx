"use client"

import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import { createPortal } from "react-dom"
import { Check, ChevronDown, Languages, Loader2, RefreshCw, TriangleAlert, X } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import type { TranscriptTranslation } from "@/lib/api/transcripts"
import { isSameLanguage, languageName, translationLanguageOptions } from "@arciin/types"
import { cn } from "@/lib/utils"

/**
 * Which language of a transcript you are reading, and how to add another.
 *
 * Menus are portaled so they overlay without stretching the panel. Surfaces are
 * forced light (`dashboard-main` + white) so they match Assist cards — not the
 * dark app chrome / black context menus.
 */
export function TranscriptLanguageBar({
  sourceLanguage,
  translations,
  activeLanguage,
  onSelect,
  onTranslate,
  translating,
  pendingLanguage,
}: {
  sourceLanguage: string | null
  translations: TranscriptTranslation[]
  activeLanguage: string | null
  onSelect: (language: string | null) => void
  onTranslate: (language: string) => void
  translating: boolean
  pendingLanguage: string | null
}) {
  const barRef = useRef<HTMLDivElement>(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")
  const pickerRef = useRef<HTMLDivElement | null>(null)
  const [pickerStyle, setPickerStyle] = useState<CSSProperties>({})

  const active = activeLanguage
    ? (translations.find((t) => t.language === activeLanguage) ?? null)
    : null
  const activeLabel = activeLanguage
    ? languageName(activeLanguage)
    : `Original${sourceLanguage ? ` — ${languageName(sourceLanguage)}` : ""}`

  const options = useMemo(() => {
    const already = new Set(translations.map((t) => t.language))
    const needle = query.trim().toLowerCase()
    return translationLanguageOptions()
      .filter((option) => {
        if (already.has(option.tag)) return false
        if (isSameLanguage(option.tag, sourceLanguage)) return false
        if (!needle) return true
        return (
          option.name.toLowerCase().includes(needle) || option.tag.toLowerCase().includes(needle)
        )
      })
      .slice(0, 120)
  }, [query, translations, sourceLanguage])

  useEffect(() => {
    if (!pickerOpen) return

    const update = () => {
      const rect = barRef.current?.getBoundingClientRect()
      if (!rect) return
      setPickerStyle({
        position: "fixed",
        top: rect.bottom + 4,
        left: rect.left,
        width: Math.max(rect.width, 280),
        zIndex: 240,
      })
    }

    /**
     * Reposition when the *anchor* moves, not when the picker's own list does.
     *
     * The listener is capture-phase so it sees scrolling anywhere, which is
     * what keeps the picker pinned to its bar inside a scrolling drawer. It
     * also saw the options list itself — ninety-odd languages in a short
     * scroll box — and re-pinned the picker mid-scroll. The panel shifted out
     * from under the pointer, so the next click landed on the full-screen
     * close overlay behind it, which clears the search box: scroll the list,
     * type, and the keystrokes vanished.
     *
     * Scrolls that originate inside the picker cannot move its anchor, so they
     * are ignored.
     */
    const onScroll = (event: Event) => {
      const target = event.target
      if (target instanceof Node && pickerRef.current?.contains(target)) return
      update()
    }

    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", onScroll, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", onScroll, true)
    }
  }, [pickerOpen])

  useEffect(() => {
    if (!pickerOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPickerOpen(false)
        setQuery("")
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [pickerOpen])

  return (
    <div ref={barRef} className="mt-3 w-full space-y-2" data-testid="transcript-language-bar">
      <div className="flex w-full items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              className={cn(
                "h-11 min-w-0 flex-1 justify-between gap-2 rounded-xl px-3.5",
                "border-zinc-200 bg-white text-[13px] font-medium text-zinc-800 shadow-sm",
                "hover:bg-zinc-50",
              )}
              data-testid="transcript-language-switcher"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Languages className="size-4 shrink-0 text-zinc-400" aria-hidden />
                <span className="truncate">{activeLabel}</span>
              </span>
              <ChevronDown className="size-4 shrink-0 text-zinc-400" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className={cn(
              "dashboard-main z-[240] w-[var(--radix-dropdown-menu-trigger-width)] max-h-64 p-1.5",
              "rounded-xl border-zinc-200 bg-white text-zinc-900 shadow-lg ring-1 ring-black/5",
            )}
          >
            <DropdownMenuItem
              onSelect={() => onSelect(null)}
              data-testid="transcript-language-option-original"
              className={cn(
                "rounded-lg px-3 py-2.5 text-[13px] focus:bg-zinc-50 focus:text-zinc-900",
                activeLanguage === null && "text-primary",
              )}
            >
              <span className="flex w-full items-center justify-between gap-2">
                <span>Original{sourceLanguage ? ` — ${languageName(sourceLanguage)}` : ""}</span>
                {activeLanguage === null ? <Check className="size-3.5 text-primary" /> : null}
              </span>
            </DropdownMenuItem>

            {translations.map((translation) => (
              <DropdownMenuItem
                key={translation.language}
                onSelect={() => onSelect(translation.language)}
                data-testid={`transcript-language-option-${translation.language}`}
                className={cn(
                  "rounded-lg px-3 py-2.5 text-[13px] focus:bg-zinc-50 focus:text-zinc-900",
                  activeLanguage === translation.language && "text-primary",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5">
                    {languageName(translation.language)}
                    {translation.stale ? (
                      <TriangleAlert className="size-3 text-amber-500" aria-label="May be outdated" />
                    ) : null}
                  </span>
                  {activeLanguage === translation.language ? (
                    <Check className="size-3.5 text-primary" />
                  ) : null}
                </span>
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator className="bg-zinc-100" />

            <DropdownMenuItem
              onSelect={() => {
                setQuery("")
                setPickerOpen(true)
              }}
              data-testid="transcript-translate-another"
              className="rounded-lg px-3 py-2.5 text-[13px] font-medium text-primary focus:bg-primary/10 focus:text-primary"
            >
              + Translate another language
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {active ? (
          <Button
            type="button"
            variant="outline"
            className="h-11 shrink-0 gap-1.5 rounded-xl border-zinc-200 bg-white px-3 text-[12.5px] shadow-sm"
            disabled={translating}
            onClick={() => onTranslate(active.language)}
            data-testid="transcript-regenerate-translation"
            title={active.stale ? "Original changed — regenerate" : "Regenerate translation"}
          >
            {translating && pendingLanguage === active.language ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            {active.stale ? "Update" : "Refresh"}
          </Button>
        ) : null}
      </div>

      {pickerOpen && typeof document !== "undefined"
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close language picker"
                className="fixed inset-0 z-[239] cursor-default bg-transparent"
                onClick={() => {
                  setPickerOpen(false)
                  setQuery("")
                }}
              />
              <div
                ref={pickerRef}
                style={pickerStyle}
                className={cn(
                  "dashboard-main overflow-hidden rounded-xl border border-zinc-200",
                  "bg-white text-zinc-900 shadow-lg ring-1 ring-black/5",
                )}
                data-testid="transcript-language-picker"
                role="dialog"
                aria-label="Choose a language to translate into"
              >
                <div className="flex items-center gap-2 border-b border-zinc-100 p-2.5">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search languages…"
                    className="h-10 flex-1 rounded-xl border-zinc-200 bg-zinc-50 text-[13px]"
                    autoFocus
                    data-testid="transcript-language-search"
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-10 shrink-0 rounded-xl"
                    aria-label="Close"
                    onClick={() => {
                      setPickerOpen(false)
                      setQuery("")
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto p-1.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                  {options.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-zinc-500">No matches</p>
                  ) : (
                    options.map((option) => (
                      <button
                        key={option.tag}
                        type="button"
                        disabled={translating}
                        data-testid={`transcript-target-${option.tag}`}
                        onClick={() => {
                          onTranslate(option.tag)
                          setPickerOpen(false)
                          setQuery("")
                        }}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-[13px] text-zinc-800 hover:bg-zinc-50 disabled:opacity-50"
                      >
                        <span>{option.name}</span>
                        <span className="text-[11px] text-zinc-400">{option.tag}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </>,
            document.body,
          )
        : null}
    </div>
  )
}

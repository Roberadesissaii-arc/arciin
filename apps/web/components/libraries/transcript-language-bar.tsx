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
 * The language switcher uses a portaled DropdownMenu so it overlays content
 * without stretching the Assist panel. The “translate another” picker is also
 * portaled (fixed to the viewport under the bar).
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
        width: Math.max(rect.width, 240),
        zIndex: 240,
      })
    }
    update()
    window.addEventListener("resize", update)
    window.addEventListener("scroll", update, true)
    return () => {
      window.removeEventListener("resize", update)
      window.removeEventListener("scroll", update, true)
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
    <div ref={barRef} className="mt-3 space-y-2" data-testid="transcript-language-bar">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 min-w-0 flex-1 justify-between gap-2 border-border bg-card text-[12.5px]"
              data-testid="transcript-language-switcher"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Languages className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{activeLabel}</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            className="z-[240] w-[var(--radix-dropdown-menu-trigger-width)] max-h-56"
          >
            <DropdownMenuItem
              onSelect={() => onSelect(null)}
              data-testid="transcript-language-option-original"
              className={cn("justify-between text-[12.5px]", activeLanguage === null && "text-primary")}
            >
              <span>Original{sourceLanguage ? ` — ${languageName(sourceLanguage)}` : ""}</span>
              {activeLanguage === null ? <Check className="size-3.5" /> : null}
            </DropdownMenuItem>

            {translations.map((translation) => (
              <DropdownMenuItem
                key={translation.language}
                onSelect={() => onSelect(translation.language)}
                data-testid={`transcript-language-option-${translation.language}`}
                className={cn(
                  "justify-between text-[12.5px]",
                  activeLanguage === translation.language && "text-primary",
                )}
              >
                <span className="flex items-center gap-1.5">
                  {languageName(translation.language)}
                  {translation.stale ? (
                    <TriangleAlert className="size-3 text-amber-500" aria-label="May be outdated" />
                  ) : null}
                </span>
                {activeLanguage === translation.language ? <Check className="size-3.5" /> : null}
              </DropdownMenuItem>
            ))}

            <DropdownMenuSeparator />

            <DropdownMenuItem
              onSelect={() => {
                setQuery("")
                setPickerOpen(true)
              }}
              data-testid="transcript-translate-another"
              className="text-[12.5px] font-medium text-primary focus:text-primary"
            >
              + Translate another language
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        {active ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1.5 border-border bg-card text-[12px]"
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
                style={pickerStyle}
                className={cn(
                  "overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-lg ring-1 ring-black/5",
                )}
                data-testid="transcript-language-picker"
                role="dialog"
                aria-label="Choose a language to translate into"
              >
                <div className="flex items-center gap-2 border-b border-zinc-100 p-2">
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search languages…"
                    className="h-8 flex-1 text-[13px]"
                    autoFocus
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="size-8 shrink-0"
                    aria-label="Close"
                    onClick={() => {
                      setPickerOpen(false)
                      setQuery("")
                    }}
                  >
                    <X className="size-3.5" />
                  </Button>
                </div>
                <div className="max-h-48 overflow-y-auto p-1">
                  {options.length === 0 ? (
                    <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">
                      No matches
                    </p>
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
                        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-zinc-50 disabled:opacity-50"
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

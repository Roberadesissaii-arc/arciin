"use client"

import { useMemo, useState } from "react"
import { Check, ChevronDown, Languages, Loader2, RefreshCw, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import type { TranscriptTranslation } from "@/lib/api/transcripts"
import { isSameLanguage, languageName, translationLanguageOptions } from "@arciin/types"
import { cn } from "@/lib/utils"

/**
 * Which language of a transcript you are reading, and how to add another.
 *
 * The dropdown is absolutely positioned so opening it overlays the transcript
 * instead of stretching the layout and shoving content down.
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
  const [open, setOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [query, setQuery] = useState("")

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

  return (
    <div className="relative z-20 mt-3 space-y-2" data-testid="transcript-language-bar">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full min-w-0 justify-between gap-2 border-border bg-card text-[12.5px]"
            data-testid="transcript-language-switcher"
            aria-expanded={open}
            onClick={() => {
              setPickerOpen(false)
              setOpen((v) => !v)
            }}
          >
            <span className="flex min-w-0 items-center gap-1.5">
              <Languages className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="truncate">{activeLabel}</span>
            </span>
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          </Button>

          {open ? (
            <div
              className={cn(
                "absolute left-0 right-0 top-[calc(100%+4px)] z-50 max-h-56 overflow-y-auto",
                "rounded-xl border border-zinc-200 bg-white p-1 shadow-lg ring-1 ring-black/5",
              )}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(null)
                  setOpen(false)
                }}
                data-testid="transcript-language-option-original"
                className={cn(
                  "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-zinc-50",
                  activeLanguage === null && "text-primary",
                )}
              >
                <span>Original{sourceLanguage ? ` — ${languageName(sourceLanguage)}` : ""}</span>
                {activeLanguage === null ? <Check className="size-3.5" /> : null}
              </button>

              {translations.map((translation) => (
                <button
                  key={translation.language}
                  type="button"
                  onClick={() => {
                    onSelect(translation.language)
                    setOpen(false)
                  }}
                  data-testid={`transcript-language-option-${translation.language}`}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[12.5px] hover:bg-zinc-50",
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
                </button>
              ))}

              <div className="my-1 h-px bg-zinc-100" />

              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setPickerOpen(true)
                }}
                data-testid="transcript-translate-another"
                className="w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium text-primary hover:bg-primary/10"
              >
                + Translate another language
              </button>
            </div>
          ) : null}
        </div>

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

      {pickerOpen ? (
        <div
          className={cn(
            "absolute left-0 right-0 top-10 z-50 overflow-hidden rounded-xl border border-zinc-200",
            "bg-white shadow-lg ring-1 ring-black/5",
          )}
          data-testid="transcript-language-picker"
        >
          <div className="border-b border-zinc-100 p-2">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search languages…"
              className="h-8 text-[13px]"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto p-1">
            {options.length === 0 ? (
              <p className="px-2 py-3 text-center text-[12px] text-muted-foreground">No matches</p>
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
          <div className="border-t border-zinc-100 p-1">
            <button
              type="button"
              className="w-full rounded-lg px-2.5 py-2 text-left text-[12px] text-zinc-500 hover:bg-zinc-50"
              onClick={() => {
                setPickerOpen(false)
                setQuery("")
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

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
 * The original is never one of the things you can overwrite — it is always the
 * first entry, and translations sit beside it. Choosing an existing language
 * only changes what is displayed; nothing is sent anywhere, because the
 * translation was saved when it was made.
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
  /** As detected on the original, e.g. "en". */
  sourceLanguage: string | null
  translations: TranscriptTranslation[]
  /** null = the original. */
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
        // Already saved, or the language it is already in — offering either
        // invites a paid request that could only return what exists.
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
    <div className="mt-3 space-y-2" data-testid="transcript-language-bar">
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 w-full min-w-0 justify-between gap-2 border-border bg-card text-[12.5px]"
              data-testid="transcript-language-switcher"
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Languages className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="truncate">{activeLabel}</span>
              </span>
              <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            </Button>
          {open ? (
            <div className="mt-1 rounded-lg border border-border bg-card p-1 shadow-sm">
            <button
              type="button"
              onClick={() => {
                onSelect(null)
                setOpen(false)
              }}
              data-testid="transcript-language-option-original"
              className={cn(
                "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted/60",
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
                  "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted/60",
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

            <div className="my-1 h-px bg-border" />

            <button
              type="button"
              onClick={() => {
                setOpen(false)
                setPickerOpen(true)
              }}
              data-testid="transcript-translate-another"
              className="w-full rounded-md px-2 py-1.5 text-left text-[12.5px] text-primary hover:bg-primary/10"
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
          >
            {translating ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <RefreshCw className="size-3.5" />
            )}
            Regenerate
          </Button>
        ) : null}
      </div>

      {/* The original moved after this language was produced. */}
      {active?.stale ? (
        <p
          className="flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1.5 text-[11.5px] text-amber-700"
          data-testid="transcript-translation-stale"
        >
          <TriangleAlert className="size-3.5 shrink-0" aria-hidden />
          Translation may be outdated — the transcript changed after it was made.
        </p>
      ) : null}

      {/* The searchable target picker. */}
      {pickerOpen ? (
        <div className="rounded-lg border border-border bg-muted/20 p-2" data-testid="transcript-language-picker">
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search languages…"
            className="h-8 text-[12.5px]"
            data-testid="transcript-language-search"
          />
          <div className="scrollbar-hide mt-2 max-h-48 overflow-y-auto">
            {options.length === 0 ? (
              <p className="px-1 py-2 text-[12px] text-muted-foreground">No languages match.</p>
            ) : (
              options.map((option) => (
                <button
                  key={option.tag}
                  type="button"
                  disabled={translating}
                  onClick={() => {
                    setPickerOpen(false)
                    setQuery("")
                    onTranslate(option.tag)
                  }}
                  data-testid={`transcript-target-${option.tag}`}
                  className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[12.5px] hover:bg-muted/60 disabled:opacity-50"
                >
                  <span>{option.name}</span>
                  <span className="text-[11px] text-muted-foreground">{option.tag}</span>
                </button>
              ))
            )}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 h-7 w-full text-[12px] text-muted-foreground"
            onClick={() => {
              setPickerOpen(false)
              setQuery("")
            }}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {translating && pendingLanguage ? (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
          Translating into {languageName(pendingLanguage)}…
        </p>
      ) : null}
    </div>
  )
}

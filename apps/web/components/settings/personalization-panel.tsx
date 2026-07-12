"use client"

import { useCallback } from "react"
import { useRouter, useSearchParams } from "next/navigation"

import {
  PersonalizationSubNav,
  personalizationSectionFromParam,
  type PersonalizationSection,
} from "@/components/settings/personalization-sub-nav"
import { PersonalizationGeneralPanel } from "@/components/settings/personalization-general-panel"
import { PersonalizationThemePanel } from "@/components/settings/personalization-theme-panel"
import { ToastsPanel } from "@/components/settings/toasts-panel"

export function PersonalizationPanel() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const section = personalizationSectionFromParam(searchParams.get("section"))

  const setSection = useCallback(
    (next: PersonalizationSection) => {
      const params = new URLSearchParams(searchParams.toString())
      params.set("tab", "appearance")
      params.set("section", next)
      router.replace(`/settings?${params.toString()}`, { scroll: false })
    },
    [router, searchParams],
  )

  return (
    <div className="space-y-5">
      <PersonalizationSubNav section={section} onSectionChange={setSection} />

      {section === "general" ? <PersonalizationGeneralPanel /> : null}
      {section === "theme" ? <PersonalizationThemePanel /> : null}
      {section === "toasters" ? <ToastsPanel /> : null}

      <p className="px-1 text-[12px] text-zinc-500">
        Changes apply immediately and sync when you sign in on another browser.
      </p>
    </div>
  )
}

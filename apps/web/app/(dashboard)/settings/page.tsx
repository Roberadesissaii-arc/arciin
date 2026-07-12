import { Suspense } from "react"

import { SettingsPage as SettingsShell } from "@/components/pages/settings/settings-page"

export default function SettingsPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-muted-foreground">Loading settings…</div>}>
      <SettingsShell />
    </Suspense>
  )
}

"use client"

import { Key } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"

export function ApiKeysPageIntro() {
  return (
    <DashboardPageIntro
      title="API keys"
      subtitle="Bearer tokens · scoped access · hashed at rest"
      cornerDecoration={<IntroCornerIcon icon={Key} />}
      description="Create keys for scripts, CI, or integrations. Raw values are shown once; the server stores only a hash and prefix. Rotate or revoke from the table below when access changes."
    />
  )
}

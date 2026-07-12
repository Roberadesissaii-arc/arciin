"use client"

import Link from "next/link"
import { Radio } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"

export function EventsPageIntro() {
  return (
    <DashboardPageIntro
      title="Events"
      subtitle="Live Socket.IO monitor · instance-wide stream"
      cornerDecoration={<IntroCornerIcon icon={Radio} />}
      description={
        <>
          Watch realtime signals as they happen — uploads from mobile, desktop, or Python scripts.
          Keep this page open while you trigger activity; events are live only and do not replay from
          before you arrived. External automation uses port{" "}
          <span className="font-mono text-[13px] text-zinc-800">4000</span> with an API key — see{" "}
          <Link
            href="/developer/api-keys"
            className="font-medium text-foreground underline-offset-2 hover:underline"
          >
            API keys
          </Link>
          .
        </>
      }
    />
  )
}

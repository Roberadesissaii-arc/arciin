import Link from "next/link"
import { Shield } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { SecurityDashboardPanel } from "@/components/settings/security-dashboard-panel"
import { Button } from "@/components/ui/button"

export default function SecurityPage() {
  return (
    <div className="w-full min-w-0 space-y-6 pb-8">
      <DashboardPageIntro
        title="Security"
        subtitle="Network perimeter"
        cornerDecoration={<IntroCornerIcon icon={Shield} />}
        description="Define which client IPs may reach this instance. Values are stored here; your reverse proxy or API gateway should honor X-Forwarded-For and these lists. Sign-in rules and API rate limits stay under Settings."
        stats={[
          { label: "Allowlist", value: "IPs · CIDR" },
          { label: "Blocklist", value: "Deny first" },
          { label: "Policy", value: "Stored" },
          { label: "Sign-in", value: "Settings" },
        ]}
        actions={
          <>
            <Button variant="outline" size="sm" asChild className="border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50">
              <Link href="/settings?tab=access-control">Access control</Link>
            </Button>
            <Button size="sm" asChild className="bg-primary text-white hover:bg-primary/90">
              <Link href="/settings">All settings</Link>
            </Button>
          </>
        }
      />
      <SecurityDashboardPanel />
    </div>
  )
}

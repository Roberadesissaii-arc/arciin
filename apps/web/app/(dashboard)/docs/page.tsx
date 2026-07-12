import { BookOpen } from "lucide-react"

import { DashboardPageIntro } from "@/components/app-shell/dashboard-page-intro"
import { IntroCornerIcon } from "@/components/app-shell/intro-corner-icon"
import { DocumentationManual } from "@/components/docs/documentation-manual"
import { flattenDocToc } from "@/lib/docs/doc-toc"
import { SOCKET_EVENT_TYPES } from "@arciin/shared"

const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL || "/api"
const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"

export default function DocsPage() {
  return (
    <div className="space-y-8 pb-16">
      <DashboardPageIntro
        title="Documentation"
        subtitle="Operator manual · API · realtime · webhooks · remote access"
        cornerDecoration={<IntroCornerIcon icon={BookOpen} />}
        description="Long-form reference for this instance. Use the table of contents to jump; every section includes copy-ready examples where it matters."
        stats={[
          { label: "REST prefix", value: apiBase.length > 18 ? `${apiBase.slice(0, 16)}…` : apiBase },
          { label: "Socket URL", value: socketUrl.length > 18 ? `${socketUrl.slice(0, 16)}…` : socketUrl },
          { label: "Event types", value: SOCKET_EVENT_TYPES.length.toString() },
          { label: "Sections", value: flattenDocToc().length.toString() },
        ]}
      />
      <DocumentationManual />
    </div>
  )
}

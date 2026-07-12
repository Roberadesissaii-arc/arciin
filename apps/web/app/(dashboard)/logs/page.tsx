import { LogsFileViewer } from "@/components/logs/logs-file-viewer"
import { LogsPageIntro } from "@/components/logs/logs-page-intro"
import { LogsSystemStatus } from "@/components/logs/logs-system-status"

export default function LogsPage() {
  return (
    <div className="space-y-6 pb-6">
      <LogsPageIntro />
      <LogsSystemStatus />
      <LogsFileViewer />
    </div>
  )
}

import { LogsFailedJobs } from "@/components/logs/logs-failed-jobs"
import { LogsFileViewer } from "@/components/logs/logs-file-viewer"
import { LogsPageIntro } from "@/components/logs/logs-page-intro"
import { LogsSystemStatus } from "@/components/logs/logs-system-status"

export default function LogsPage() {
  return (
    <div className="space-y-6 pb-6">
      <LogsPageIntro />
      <LogsSystemStatus />
      <div className="grid gap-4 xl:grid-cols-5">
        <div className="xl:col-span-3">
          <LogsFileViewer />
        </div>
        <div className="xl:col-span-2">
          <LogsFailedJobs />
        </div>
      </div>
    </div>
  )
}

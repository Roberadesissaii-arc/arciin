import { JobsList } from "@/components/dashboard/jobs-list"
import { PageHeader } from "@/components/app-shell/page-header"

export default function JobsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Jobs"
        description="Background processing, cleanup passes, and future integration sync work."
      />
      <JobsList />
    </div>
  )
}

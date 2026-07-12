import { JobsPageIntro } from "@/components/dashboard/jobs-page-intro"
import { JobsList } from "@/components/dashboard/jobs-list"

export default function JobsPage() {
  return (
    <div className="space-y-6 pb-6">
      <JobsPageIntro />
      <JobsList />
    </div>
  )
}

import { UploadsPageIntro } from "@/components/dashboard/uploads-page-intro"
import { UploadsSessionsTable } from "@/components/uploads/uploads-sessions-table"

export default function UploadsPage() {
  return (
    <div className="space-y-6 pb-6">
      <UploadsPageIntro />
      <UploadsSessionsTable />
    </div>
  )
}

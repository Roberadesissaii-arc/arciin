import { PageHeader } from "@/components/app-shell/page-header"
import { UploadHistory } from "@/components/uploads/upload-history"

export default function UploadsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Uploads"
        description="Track the queue, recent sessions, and routed destinations across the instance."
      />
      <UploadHistory />
    </div>
  )
}

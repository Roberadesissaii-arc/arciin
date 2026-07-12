import { RecentUploadsCard } from "@/components/dashboard/recent-uploads-card"
import { UploadsPageIntro } from "@/components/dashboard/uploads-page-intro"

export default function UploadsPage() {
  return (
    <div className="space-y-6 pb-6">
      <UploadsPageIntro />
      <RecentUploadsCard limit={200} showLink={false} />
    </div>
  )
}

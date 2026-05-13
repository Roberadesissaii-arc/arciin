import { PageHeader } from "@/components/app-shell/page-header"
import { RemoteAccessPanel } from "@/components/settings/remote-access-panel"

export default function RemoteAccessPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Remote Access"
        description="Start local, then add a domain, reverse proxy, or tunnel only when you need it."
      />
      <RemoteAccessPanel />
    </div>
  )
}

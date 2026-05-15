import { DomainPanel } from "@/components/settings/domain-panel"

export default function DomainSettingsPage() {
  return (
    <div className="space-y-6 pb-8">
      <div className="min-w-0 flex-1 overflow-x-auto rounded-2xl border border-border bg-card px-4 py-5 shadow-sm sm:px-7 sm:py-6">
        <DomainPanel />
      </div>
    </div>
  )
}

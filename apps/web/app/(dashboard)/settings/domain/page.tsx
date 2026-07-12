import { redirect } from "next/navigation"

export default function DomainSettingsPage() {
  redirect("/settings?tab=domain")
}

import { AccountShell } from "@/components/account-shell"
import type { ProfileSummary } from "@/components/profile-menu"
import { DEMO_CUSTOMER } from "@/lib/demo-customer"
import { fetchAccountOverview, licenseServerHealth } from "@/lib/license-api"

export default async function AccountLayout({ children }: { children: React.ReactNode }) {
  const serverOk = await licenseServerHealth()

  let profile: ProfileSummary = {
    name: DEMO_CUSTOMER.name,
    email: DEMO_CUSTOMER.email,
    plan: "none",
    licenseCount: 0,
    activeLicenses: 0,
    activatedServers: 0,
    nextRenewalAt: null,
    serverOk,
  }

  if (serverOk) {
    try {
      const overview = await fetchAccountOverview()
      profile = {
        name: overview.customer.name || DEMO_CUSTOMER.name,
        email: overview.customer.email || DEMO_CUSTOMER.email,
        plan: overview.summary.primaryPlan,
        licenseCount: overview.summary.licenseCount,
        activeLicenses: overview.summary.activeLicenses,
        activatedServers: overview.summary.activatedServers,
        nextRenewalAt: overview.summary.nextRenewalAt,
        serverOk: true,
      }
    } catch {
      profile = { ...profile, serverOk: false }
    }
  }

  return <AccountShell profile={profile}>{children}</AccountShell>
}

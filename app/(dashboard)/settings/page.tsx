import Link from "next/link"

import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const sections = [
  {
    title: "Storage",
    href: "/settings/storage",
    description: "Managed local paths, usage, and write availability.",
  },
  {
    title: "Remote Access",
    href: "/settings/remote-access",
    description: "Public URL, reverse proxy mode, and tunnel guidance.",
  },
  {
    title: "Security",
    href: "/settings/security",
    description: "Session model, local auth, and platform protection notes.",
  },
  {
    title: "Users",
    href: "/settings/users",
    description: "Owner account details and future member management.",
  },
]

export default function SettingsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="General Settings"
        description="Instance-wide configuration for storage, access, and security."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {sections.map((section) => (
          <Link key={section.href} href={section.href}>
            <Card className="h-full border-white/8 bg-white/[0.02] transition hover:border-[#FF4B33]/15 hover:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-white">{section.title}</CardTitle>
                <CardDescription className="text-zinc-400">
                  {section.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-zinc-500">Open section</CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  )
}

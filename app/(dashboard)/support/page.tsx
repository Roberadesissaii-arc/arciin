import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const resources = [
  {
    title: "Documentation",
    href: "/docs",
    description: "Guides, API reference, and configuration options for Arciin.",
  },
  {
    title: "GitHub Issues",
    href: "https://github.com/your-org/arciin/issues",
    description: "Report a bug or request a feature directly on GitHub.",
  },
  {
    title: "Community",
    href: "https://github.com/your-org/arciin/discussions",
    description: "Ask questions and share ideas with other Arciin users.",
  },
  {
    title: "Release Notes",
    href: "#",
    description: "What's new in each version of Arciin.",
  },
]

export default function SupportPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Support"
        description="Find documentation, report issues, and get help with your Arciin instance."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {resources.map((r) => (
          <a key={r.title} href={r.href} target={r.href.startsWith("http") ? "_blank" : undefined} rel="noopener noreferrer">
            <Card className="h-full border-white/8 bg-white/[0.02] transition hover:border-[#FF4B33]/15 hover:bg-white/[0.03]">
              <CardHeader>
                <CardTitle className="text-white">{r.title}</CardTitle>
                <CardDescription className="text-zinc-400">{r.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-zinc-500">Open →</CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  )
}

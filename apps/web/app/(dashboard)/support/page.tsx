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
    href: "https://github.com/Roberadesissaii-arc/arciin/issues",
    description: "Report a bug or request a feature directly on GitHub.",
  },
  {
    title: "Community",
    href: "https://github.com/Roberadesissaii-arc/arciin/discussions",
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
            <Card className="h-full border-border bg-card transition hover:border-[#FF4B33]/15 hover:bg-muted/30">
              <CardHeader>
                <CardTitle className="text-foreground">{r.title}</CardTitle>
                <CardDescription className="text-zinc-600">{r.description}</CardDescription>
              </CardHeader>
              <CardContent className="text-sm text-zinc-500">Open →</CardContent>
            </Card>
          </a>
        ))}
      </div>
    </div>
  )
}

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { dashboardStatIconShell } from "@/lib/dashboard-card-styles"
import { LibrarySlugIcon } from "@/components/libraries/library-slug-icon"
import type { LibrarySummary } from "@/lib/types/models"

export function LibraryCard({ library }: { library: LibrarySummary }) {
  return (
    <Card className="border-border bg-muted/30 shadow-none transition-colors hover:border-primary/30 hover:bg-muted/50">
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-3">
          <div className={dashboardStatIconShell}>
            <LibrarySlugIcon slug={library.slug} kind={library.kind} className="size-4" />
          </div>
          <div>
            <CardTitle className="text-foreground">{library.name}</CardTitle>
            <div className="mt-1 text-sm font-medium text-zinc-600">{library.assetCount} assets</div>
          </div>
        </div>
        <Badge className="shrink-0 rounded-md border-0 bg-primary px-2.5 text-xs font-semibold text-primary-foreground shadow-none hover:bg-primary/90">
          {library.folderCount} folders
        </Badge>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-3">
        <div className="text-sm text-zinc-600">
          {library.description || "Managed library for your self-hosted archive."}
        </div>
        <Link
          href={library.slug === "videos" ? "/videos" : `/${library.slug}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          Open
          <ArrowUpRight className="size-4" />
        </Link>
      </CardContent>
    </Card>
  )
}

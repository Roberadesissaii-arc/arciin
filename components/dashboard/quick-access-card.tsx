"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useLibraries } from "@/hooks/use-libraries"

export function QuickAccessCard() {
  const librariesQuery = useLibraries()

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-foreground">Quick access</CardTitle>
        <CardDescription className="text-muted-foreground">
          Jump straight into the libraries you touch most.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {(librariesQuery.data || []).slice(0, 4).map((library) => (
          <Link
            key={library.id}
            href={`/${library.slug}`}
            className="flex items-center justify-between rounded-2xl border border-border bg-muted/40 px-4 py-3 text-sm text-foreground transition-colors hover:border-border hover:bg-muted/60"
          >
            <span>{library.name}</span>
            <ArrowUpRight className="size-4 text-muted-foreground" />
          </Link>
        ))}
        {!librariesQuery.isLoading && !(librariesQuery.data || []).length ? (
          <div className="rounded-2xl border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Claim the instance and create default libraries to populate quick access.
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

"use client"

import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useLibraries } from "@/hooks/use-libraries"

export function QuickAccessCard() {
  const librariesQuery = useLibraries()

  return (
    <Card className="border-white/8 bg-white/[0.02]">
      <CardHeader>
        <CardTitle className="text-white">Quick access</CardTitle>
        <CardDescription className="text-zinc-400">
          Jump straight into the libraries you touch most.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {(librariesQuery.data || []).slice(0, 4).map((library) => (
          <Link
            key={library.id}
            href={`/${library.slug}`}
            className="flex items-center justify-between rounded-2xl border border-border/60 bg-muted/15 px-4 py-3 text-sm text-foreground transition-colors hover:border-border hover:bg-muted/30"
          >
            <span>{library.name}</span>
            <ArrowUpRight className="size-4 text-zinc-500" />
          </Link>
        ))}
        {!librariesQuery.isLoading && !(librariesQuery.data || []).length ? (
          <div className="rounded-2xl border border-white/8 bg-black/20 p-4 text-sm text-zinc-400">
            Claim the instance and create default libraries to populate quick access.
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

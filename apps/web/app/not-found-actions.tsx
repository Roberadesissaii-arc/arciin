"use client"

import Link from "next/link"
import { ArrowLeft, Home } from "lucide-react"

import { Button } from "@/components/ui/button"

export function NotFoundActions() {
  return (
    <div className="flex flex-wrap items-center justify-center gap-3">
      <Button
        asChild
        className="inline-flex items-center gap-2 bg-primary px-6 text-primary-foreground shadow-md hover:bg-primary/90"
      >
        <Link href="/" className="inline-flex items-center gap-2">
          <Home className="size-4" />
          Go home
        </Link>
      </Button>
      <Button
        type="button"
        variant="outline"
        className="inline-flex items-center gap-2 border-2 border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50"
        onClick={() => history.back()}
      >
        <ArrowLeft className="size-4" />
        Go back
      </Button>
    </div>
  )
}

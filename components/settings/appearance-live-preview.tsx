"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Instant feedback while editing appearance — uses live --primary from preferences. */
export function AppearanceLivePreview() {
  return (
    <Card className="border-dashed border-border bg-muted/30">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Live preview</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-3">
        <Button type="button" size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90">
          Primary button
        </Button>
        <span className="rounded-md bg-primary/15 px-2 py-1 text-[12px] font-medium text-primary">
          Accent badge
        </span>
        <p className="text-[12px] text-muted-foreground">
          Toggle compact view or pick a color — this updates immediately.
        </p>
      </CardContent>
    </Card>
  )
}

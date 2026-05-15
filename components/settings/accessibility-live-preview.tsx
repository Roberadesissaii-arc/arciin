"use client"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

/** Shows font, contrast, and focus settings as they apply in the dashboard. */
export function AccessibilityLivePreview() {
  return (
    <Card className="border-dashed border-border bg-muted/30 shadow-none hover:shadow-none">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-foreground">Live preview</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[13px] leading-relaxed text-foreground">
          This sample text scales with <strong>Font size</strong>. Switch sizes to see the dashboard
          zoom change.
        </p>
        <Button type="button" size="sm" variant="outline" className="border-border">
          Tab to me — focus ring follows Keyboard navigation
        </Button>
      </CardContent>
    </Card>
  )
}

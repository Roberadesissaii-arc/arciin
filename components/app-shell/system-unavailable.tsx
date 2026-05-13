import { AlertTriangle, ServerCrash } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

export function SystemUnavailable({
  title = "Arciin could not initialize its instance service.",
  description = "The web shell is up, but the API, Redis, or database configuration is not ready right now.",
}: {
  title?: string
  description?: string
}) {
  return (
    <main className="flex min-h-svh items-center justify-center px-6 py-16">
      <Card className="w-full max-w-xl border-white/10 bg-black/40 shadow-[0_0_50px_rgba(255,75,51,0.06)] backdrop-blur-sm">
        <CardHeader>
          <div className="mb-2 flex size-12 items-center justify-center rounded-2xl bg-[#FF4B33]/12 text-[#FF8F66]">
            <ServerCrash className="size-6" />
          </div>
          <CardTitle className="text-2xl text-white">{title}</CardTitle>
          <CardDescription className="text-sm text-zinc-400">{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-start gap-3 rounded-xl border border-white/8 bg-white/[0.03] p-4 text-sm text-zinc-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#F59E0B]" />
            <p>
              Make sure the Fastify API is running and that{" "}
              <span className="font-mono text-zinc-200">ARCIIN_API_URL</span> points at it.
              If the API is up but this page remains, verify Redis and the database credentials too.
            </p>
          </div>
          <Button asChild size="lg" className="w-full bg-primary text-white hover:bg-primary/90">
            <a href="http://localhost:4000/api/health" target="_blank" rel="noreferrer">
              Probe API health
            </a>
          </Button>
        </CardContent>
      </Card>
    </main>
  )
}

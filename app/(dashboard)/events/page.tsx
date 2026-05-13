import { PageHeader } from "@/components/app-shell/page-header"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { socketEventTypes } from "@/lib/types/events"

export default function EventsPage() {
  return (
    <div className="space-y-6">
      <PageHeader
        title="Developer Events"
        description="Realtime event shapes and transport details for the local instance."
      />
      <div className="grid gap-4 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Socket endpoint</CardTitle>
            <CardDescription className="text-zinc-400">
              Connect with session cookies after authenticating through the local instance.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm text-zinc-400">
            <p>
              WebSocket URL:{" "}
              <span className="font-mono text-zinc-200">
                {process.env.NEXT_PUBLIC_SOCKET_URL || "http://localhost:4000"}
              </span>
            </p>
            <p>Rooms are scoped by user, instance, library, upload, and job.</p>
          </CardContent>
        </Card>
        <Card className="border-white/8 bg-white/[0.02]">
          <CardHeader>
            <CardTitle className="text-white">Event types</CardTitle>
            <CardDescription className="text-zinc-400">
              The first production set covers uploads, assets, jobs, activity, and Plex placeholders.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2 sm:grid-cols-2">
            {socketEventTypes.map((eventType) => (
              <div
                key={eventType}
                className="rounded-2xl border border-white/8 bg-black/20 px-3 py-2 font-mono text-xs text-zinc-300"
              >
                {eventType}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card className="border-white/8 bg-white/[0.02]">
        <CardHeader>
          <CardTitle className="text-white">Example payload</CardTitle>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-2xl border border-white/8 bg-black/25 p-4 text-xs text-zinc-300">
{`{
  "id": "evt_01",
  "type": "upload.completed",
  "userId": "usr_123",
  "libraryId": "lib_videos",
  "uploadId": "upl_456",
  "assetId": "ast_789",
  "progress": 100,
  "message": "movie.mp4 uploaded successfully.",
  "createdAt": "2026-05-12T12:00:00.000Z"
}`}
          </pre>
        </CardContent>
      </Card>
    </div>
  )
}

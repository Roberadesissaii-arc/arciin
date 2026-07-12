import { notFound } from "next/navigation"

/**
 * Any path under the dashboard shell that does not match a more specific route
 * renders `(dashboard)/not-found` (sidebar + centered 404), same idea as
 * Arceclaw’s shell-wrapped 404.
 */
export default function DashboardCatchAllPage() {
  notFound()
}

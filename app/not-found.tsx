import { NotFoundView } from "@/components/app-shell/not-found-view"

/** Routes outside the dashboard shell (e.g. unmatched legal paths). */
export default function NotFound() {
  return <NotFoundView variant="fullscreen" />
}

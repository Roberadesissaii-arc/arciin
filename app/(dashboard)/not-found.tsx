import { NotFoundView } from "@/components/app-shell/not-found-view"

/** Unknown app routes: keep sidebar + header; center the 404 card in the main column. */
export default function DashboardNotFound() {
  return <NotFoundView variant="embedded" />
}

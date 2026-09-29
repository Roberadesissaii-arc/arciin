import type { ImportInspection } from "@arciin/shared"

/**
 * Where the sheet is, as one value, so every state has its own words and
 * nothing spins forever:
 *   empty → preparing (typing settles) → inspecting → single | multiple |
 *   none | blocked | error.  "invalid" is input that is not a link at all.
 */
export type ImportSheetPhase =
  | "empty"
  | "invalid"
  | "preparing"
  | "inspecting"
  | "single"
  | "multiple"
  | "none"
  | "blocked"
  | "error"

export function importSheetPhase(input: {
  text: string
  normalizedOk: boolean
  clientBlocked: boolean
  settled: boolean
  inspection: ImportInspection | undefined
  inspecting: boolean
  inspectFailed: boolean
  /** The server refused the address itself (private network, not a web link). */
  inspectRefused?: boolean
}): ImportSheetPhase {
  if (!input.text.trim()) return "empty"
  if (!input.normalizedOk) return "invalid"
  if (input.clientBlocked) return "blocked"
  if (!input.settled) return "preparing"
  if (input.inspecting) return "inspecting"
  if (input.inspectRefused) return "blocked"
  if (input.inspectFailed) return "error"
  const inspection = input.inspection
  if (!inspection) return "inspecting"
  if (inspection.kind === "blocked") return "blocked"
  if (inspection.kind === "collection" && inspection.items.length > 1) return "multiple"
  if (inspection.kind === "none") return "none"
  return "single"
}

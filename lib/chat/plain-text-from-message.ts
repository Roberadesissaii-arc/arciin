import { stripHighlightTags } from "@/lib/files/parse-pdf-highlight-request"
import { stripGotoPageTags } from "@/lib/files/parse-pdf-page-request"

/** Plain text for copy / text-to-speech from assistant markdown. */
export function plainTextFromMessage(content: string): string {
  return stripHighlightTags(stripGotoPageTags(content))
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[#*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

import { stripImagePointTags } from "@/lib/files/parse-image-point-tags"

/** Remove machine-only image highlight markup before showing assistant text in chat. */
export function stripImageHighlightDisplayMarkup(text: string): string {
  return stripImagePointTags(
    text
      .replace(/\[highlight-image:[^\]]+\]/gi, "")
      .replace(/```(?:json)?\s*\{[\s\S]*?"boxes"[\s\S]*?\}\s*```/gi, "")
      .replace(/\{"boxes"\s*:\s*\[[\s\S]*?\]\s*\}/g, "")
      .replace(/\n{3,}/g, "\n\n"),
  ).trim()
}

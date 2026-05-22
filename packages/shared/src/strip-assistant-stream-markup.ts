/** Remove leaked tool-call / function markup from streamed assistant text. */
export function stripAssistantStreamMarkup(text: string): string {
  return (
    text
      .replace(/<\|tool[\s\S]*?calls[\s\S]*?end\|>/gi, "")
      .replace(/<\|tool[^|]*\|>/gi, "")
      .replace(/<function>[\s\S]*?<\/function>/gi, "")
      .replace(/\bfunction\s*read_pdf_asset\s*\{[\s\S]*?\}/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

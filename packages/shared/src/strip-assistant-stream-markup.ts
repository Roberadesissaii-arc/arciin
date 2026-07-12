/** Remove leaked tool-call / function markup from streamed assistant text. */
export function stripAssistantStreamMarkup(text: string): string {
  return (
    text
      .replace(/<\|tool[\s\S]*?calls[\s\S]*?end\|>/gi, "")
      .replace(/<\|tool[^|]*\|>/gi, "")
      .replace(/<function>[\s\S]*?<\/function>/gi, "")
      .replace(/\bfunction\s*read_pdf_asset\s*\{[\s\S]*?\}/gi, "")
      .replace(/\[\[readPdfAssetContent:\s*[^\]]+\]\]/gi, "")
      .replace(/\[\[read_text_asset:\s*[^\]]+\]\]/gi, "")
      .replace(/\[\[read[A-Za-z_]+:\s*[^\]]+\]\]/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

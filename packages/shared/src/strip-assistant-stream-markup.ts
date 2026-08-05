/** Remove leaked tool-call / function markup from streamed assistant text. */
export function stripAssistantStreamMarkup(text: string): string {
  return (
    text
      // XML-style tool calls (Ollama / custom wrappers)
      .replace(/<\s*tool_call\b[^>]*>[\s\S]*?<\/\s*tool_call\s*>/gi, "")
      .replace(/<\s*tool_call\b[^>]*\/>/gi, "")
      .replace(/<\s*tool_calls?\b[^>]*>[\s\S]*?<\/\s*tool_calls?\s*>/gi, "")
      .replace(/<\s*function_call\b[^>]*>[\s\S]*?<\/\s*function_call\s*>/gi, "")
      .replace(/<\s*invoke\b[^>]*>[\s\S]*?<\/\s*invoke\s*>/gi, "")
      // Unclosed / partial tool blocks still streaming
      .replace(/<\s*tool_call\b[\s\S]*$/gi, "")
      .replace(/<\s*function_call\b[\s\S]*$/gi, "")
      // Qwen / special token tool markup
      .replace(/<\|tool[\s\S]*?calls[\s\S]*?end\|>/gi, "")
      .replace(/<\|tool[^|]*\|>/gi, "")
      .replace(/<\/?tool_call>/gi, "")
      .replace(/<function>[\s\S]*?<\/function>/gi, "")
      // Bare function { ... } dumps
      .replace(/\bfunction\s*read_pdf_asset\s*\{[\s\S]*?\}/gi, "")
      .replace(/\bfunction\s*read_text_asset\s*\{[\s\S]*?\}/gi, "")
      .replace(/\b(?:read_pdf_asset|read_text_asset)\s*\(\s*\{[\s\S]*?\}\s*\)/gi, "")
      // JSON-only tool argument dumps that often follow a tool_call open tag
      .replace(
        /(?:^|\n)\s*\{\s*"(?:asset_id|filename|name|arguments)"\s*:\s*"[^"]*"\s*(?:,\s*"[^"]+"\s*:\s*[^}]+)?\s*\}\s*(?=\n|$)/gi,
        "\n",
      )
      // Internal double-bracket tool tags
      .replace(/\[\[readPdfAssetContent:\s*[^\]]+\]\]/gi, "")
      .replace(/\[\[read_text_asset:\s*[^\]]+\]\]/gi, "")
      .replace(/\[\[read[A-Za-z_]+:\s*[^\]]+\]\]/gi, "")
      // Bracketed "Attempting to read PDF: …" / "Reading PDF: …" model narration
      .replace(/\[(?:Attempting to read|Reading)[^\]]*\]/gi, "")
      // "Calling tool …" narration lines
      .replace(
        /(?:^|\n)\s*(?:Calling|Invoking|Running|Using)\s+(?:tool\s+)?`?(?:read_pdf_asset|read_text_asset)[`\w.]*\s*\.?[ \t]*/gi,
        "\n",
      )
      // Process-talk lines before the real answer (keep multi-line essays intact)
      .replace(
        /(?:^|\n)\s*(?:I need to read|Let me (?:read|open|fetch)|I(?:'ll| will) (?:read|open)|Attempting to read)[^\n]{0,200}/gi,
        "\n",
      )
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  )
}

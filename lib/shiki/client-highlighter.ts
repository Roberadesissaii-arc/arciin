"use client"

import type { Highlighter } from "shiki"

/** Light theme — readable colored syntax on the code preview card (not flat black). */
export const CODE_PREVIEW_THEME = "github-light" as const

const BUNDLED_LANGS = [
  "python",
  "javascript",
  "typescript",
  "tsx",
  "jsx",
  "json",
  "html",
  "css",
  "scss",
  "sass",
  "less",
  "vue",
  "svelte",
  "go",
  "rust",
  "java",
  "kotlin",
  "c",
  "cpp",
  "csharp",
  "php",
  "ruby",
  "bash",
  "fish",
  "powershell",
  "sql",
  "yaml",
  "toml",
  "xml",
  "swift",
  "r",
  "lua",
  "perl",
  "scala",
  "zig",
  "dart",
  "elixir",
  "erlang",
  "haskell",
  "clojure",
  "docker",
  "make",
  "markdown",
  "csv",
  "log",
  "plaintext",
  "dotenv",
  "ini",
] as const

let highlighter: Highlighter | null = null
let loadPromise: Promise<Highlighter> | null = null

export async function getCodeHighlighter(): Promise<Highlighter> {
  if (highlighter) return highlighter
  if (!loadPromise) {
    loadPromise = import("shiki").then(({ createHighlighter }) =>
      createHighlighter({
        themes: [CODE_PREVIEW_THEME],
        langs: [...BUNDLED_LANGS],
      }),
    )
    loadPromise = loadPromise.then((h) => {
      highlighter = h
      return h
    })
  }
  return loadPromise
}

export async function highlightCodeToHtml(code: string, lang: string): Promise<string> {
  const h = await getCodeHighlighter()
  const tryLang = (language: string) =>
    h.codeToHtml(code, { lang: language, theme: CODE_PREVIEW_THEME })

  try {
    return await tryLang(lang)
  } catch {
    try {
      return await tryLang("plaintext")
    } catch {
      return `<pre class="shiki"><code>${escapeHtml(code)}</code></pre>`
    }
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

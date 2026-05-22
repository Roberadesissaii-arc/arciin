"use client"

import type React from "react"

/** Fenced code: leading whitespace ok; multiline body or single-line ` ```js code ``` `. */
const FENCE_RE =
  /(?:^|\n)\s*```([a-zA-Z0-9+#.-]*)(?:[ \t]+([^\n`]+)|\s*\r?\n([\s\S]*?))```[ \t]*(?:\r?\n|$)/g

function parseInline(text: string): React.ReactNode {
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(
        <strong key={k++} className="font-semibold text-zinc-900">
          {m[1]}
        </strong>,
      )
    } else if (m[2] !== undefined) {
      nodes.push(<em key={k++}>{m[2]}</em>)
    } else if (m[3] !== undefined) {
      nodes.push(
        <code
          key={k++}
          className="rounded bg-zinc-100 px-[5px] py-px font-mono text-[11px] text-zinc-700"
        >
          {m[3]}
        </code>,
      )
    } else if (m[4] !== undefined && m[5] !== undefined) {
      const href = m[5]
      const isInternal = href.startsWith("/")
      nodes.push(
        <a
          key={k++}
          href={href}
          target={isInternal ? "_self" : "_blank"}
          rel={isInternal ? undefined : "noopener noreferrer"}
          className="inline-flex items-center gap-0.5 rounded-md bg-[#ff4f12]/10 px-1.5 py-0.5 text-[12px] font-medium text-[#ff4f12] underline-offset-2 hover:underline"
        >
          {m[4]}
        </a>,
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length === 1 ? nodes[0] : nodes
}

function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const trimmed = code.replace(/\n+$/, "")
  if (!trimmed) return null
  return (
    <div className="my-2.5 w-full min-w-0 max-w-full overflow-hidden rounded-xl border border-border bg-muted shadow-sm">
      {lang ? (
        <div className="border-b border-border px-3 py-1.5 font-mono text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {lang}
        </div>
      ) : null}
      <pre className="scrollbar-hide max-h-[min(40vh,320px)] overflow-x-auto overflow-y-auto px-3 py-2.5">
        <code className="block font-mono text-[11px] leading-relaxed whitespace-pre text-foreground">
          {trimmed}
        </code>
      </pre>
    </div>
  )
}

type Segment =
  | { type: "text"; body: string }
  | { type: "code"; lang?: string; body: string }

function pushCodeSegment(
  segments: Segment[],
  lang: string | undefined,
  body: string,
) {
  const code = body.replace(/\n+$/, "")
  if (!code.trim()) return
  segments.push({
    type: "code",
    lang: lang?.trim() || undefined,
    body: code,
  })
}

function splitMarkdownSegments(content: string): Segment[] {
  const segments: Segment[] = []
  let lastIndex = 0
  FENCE_RE.lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = FENCE_RE.exec(content)) !== null) {
    const blockStart = match.index + (match[0][0] === "\n" ? 1 : 0)
    if (blockStart > lastIndex) {
      const text = content.slice(lastIndex, blockStart)
      if (text.trim()) segments.push({ type: "text", body: text })
    }
    const body = match[3] ?? match[2] ?? ""
    pushCodeSegment(segments, match[1], body)
    lastIndex = match.index + match[0].length
  }

  const tail = content.slice(lastIndex)
  if (tail) {
    const open = tail.match(
      /(?:^|\n)\s*```([a-zA-Z0-9+#.-]*)?(?:\s*\r?\n([\s\S]*)|\s*)$/,
    )
    if (open && open.index !== undefined) {
      const before = tail.slice(0, open.index)
      if (before.trim()) segments.push({ type: "text", body: before })
      pushCodeSegment(segments, open[1], open[2] ?? "")
    } else if (tail.trim()) {
      segments.push({ type: "text", body: tail })
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", body: content })
  }

  return segments
}

function ProseMarkdown({ content }: { content: string }) {
  const lines = content.split("\n")
  const nodes: React.ReactNode[] = []
  const listItems: { text: string; ordered: boolean }[] = []
  const tableLines: string[] = []
  let k = 0

  function flushList() {
    if (!listItems.length) return
    const ordered = listItems[0].ordered
    const items = listItems.splice(0)
    nodes.push(
      ordered ? (
        <ol key={k++} className="my-1 list-decimal space-y-0.5 pl-5 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="pl-0.5 leading-relaxed">
              {parseInline(it.text)}
            </li>
          ))}
        </ol>
      ) : (
        <ul key={k++} className="my-1 space-y-0.5 pl-1 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-zinc-400" />
              <span className="min-w-0 break-words">{parseInline(it.text)}</span>
            </li>
          ))}
        </ul>
      ),
    )
  }

  function flushTable() {
    if (!tableLines.length) return
    const rows = tableLines.splice(0)
    const parseRow = (line: string) => line.split("|").slice(1, -1).map((c) => c.trim())
    const isSep = (line: string) =>
      line.replace(/\s/g, "").replace(/[|:\-]/g, "").length === 0 && line.includes("-")
    const sepIdx = rows.findIndex(isSep)
    const headerCells = rows[0] ? parseRow(rows[0]) : []
    const bodyRows = rows
      .filter((_, i) => i !== 0 && (sepIdx === -1 || i !== sepIdx))
      .map(parseRow)
      .filter((r) => r.length > 0)

    nodes.push(
      <div key={k++} className="my-2 max-w-full overflow-x-auto rounded-xl border border-zinc-200">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-zinc-50">
              {headerCells.map((cell, ci) => (
                <th
                  key={ci}
                  className="border-b border-zinc-200 px-3 py-2 text-left font-semibold text-zinc-900"
                >
                  {parseInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-zinc-50/80" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b border-zinc-100 px-3 py-2 text-zinc-800 last:border-0"
                  >
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>,
    )
  }

  function flushAll() {
    flushList()
    flushTable()
  }

  for (const line of lines) {
    const trimmed = line.trimStart()

    if (trimmed.startsWith("|")) {
      flushList()
      tableLines.push(line)
      continue
    }
    flushTable()

    const h2 = trimmed.match(/^#{1,2}\s+(.+)/)
    const h3 = !h2 && trimmed.match(/^###\s+(.+)/)
    const section =
      !h2 &&
      !h3 &&
      /^[A-Za-z][\w\s\-/]{1,48}:$/.test(trimmed) &&
      !trimmed.startsWith("-")
    const hr = /^---+$/.test(trimmed)
    const ul = trimmed.match(/^[-*]\s+(.+)/)
    const ol = trimmed.match(/^\d+\.\s+(.+)/)

    if (h2) {
      flushList()
      nodes.push(
        <p key={k++} className="mb-0.5 mt-3 text-[13px] font-bold text-zinc-900 first:mt-0">
          {parseInline(h2[1])}
        </p>,
      )
    } else if (h3) {
      flushList()
      nodes.push(
        <p key={k++} className="mb-0.5 mt-2 text-[13px] font-semibold text-zinc-900">
          {parseInline(h3[1])}
        </p>,
      )
    } else if (section) {
      flushList()
      nodes.push(
        <p key={k++} className="mb-0.5 mt-2.5 text-[13px] font-semibold text-zinc-900 first:mt-0">
          {trimmed.slice(0, -1)}
        </p>,
      )
    } else if (hr) {
      flushList()
      nodes.push(<hr key={k++} className="my-2 border-zinc-200" />)
    } else if (ul) {
      if (listItems[0]?.ordered) flushList()
      listItems.push({ text: ul[1], ordered: false })
    } else if (ol) {
      if (listItems[0] && !listItems[0].ordered) flushList()
      listItems.push({ text: ol[1], ordered: true })
    } else if (trimmed === "") {
      flushList()
    } else {
      flushList()
      nodes.push(
        <p key={k++} className="break-words text-[13px] leading-relaxed">
          {parseInline(line)}
        </p>,
      )
    }
  }

  flushAll()
  return <div className="min-w-0 space-y-[3px]">{nodes}</div>
}

export function ChatMarkdownContent({ content }: { content: string }) {
  const segments = splitMarkdownSegments(content)
  let k = 0

  return (
    <div className="min-w-0 max-w-full space-y-[2px]">
      {segments.map((seg) => {
        if (seg.type === "code") {
          return <CodeBlock key={k++} lang={seg.lang} code={seg.body} />
        }
        return <ProseMarkdown key={k++} content={seg.body} />
      })}
    </div>
  )
}

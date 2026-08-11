"use client"

import { extractBlockMath, readMathBlockPlaceholder } from "@arciin/shared"

import {
  InlineAssetBlock,
  InlineAssetBlockByIds,
  InlineAssetFilenameList,
} from "@/components/chat/chat-inline-assets"
import { MathBlock, renderInlineWithMath } from "@/components/chat/math"

// ── Markdown renderer ──────────────────────────────────────────────────────────

function parseInlineText(text: string): React.ReactNode {
  // Matches: **bold**, *italic*, `code`, [label](url)
  const pattern = /\*\*(.+?)\*\*|\*(.+?)\*|`([^`]+)`|\[([^\]]+)\]\(([^)]+)\)/g
  const nodes: React.ReactNode[] = []
  let last = 0
  let k = 0
  let m: RegExpExecArray | null

  while ((m = pattern.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      nodes.push(<strong key={k++} className="font-semibold text-foreground">{m[1]}</strong>)
    } else if (m[2] !== undefined) {
      nodes.push(<em key={k++}>{m[2]}</em>)
    } else if (m[3] !== undefined) {
      nodes.push(
        <code key={k++} className="rounded bg-zinc-100 px-[5px] py-px font-mono text-[11px] text-zinc-700">
          {m[3]}
        </code>
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
          className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[12px] font-medium text-primary underline-offset-2 transition-colors hover:bg-primary/20 hover:underline"
        >
          {m[4]}
        </a>
      )
    }
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes.length === 1 ? nodes[0] : nodes
}

/** Inline markdown with LaTeX spans rendered by KaTeX. */
function parseInline(text: string): React.ReactNode {
  return renderInlineWithMath(text, parseInlineText)
}

export function MarkdownContent({ content }: { content: string }) {
  // Display equations lifted out before the line loop — see the canvas
  // renderer for why this happens first.
  const { text: withMathPlaceholders, blocks: mathBlocks } = extractBlockMath(content)
  const lines = withMathPlaceholders.split("\n")
  const nodes: React.ReactNode[] = []
  const listItems: { text: string; ordered: boolean }[] = []
  const tableLines: string[] = []
  let inCode = false
  const codeLines: string[] = []
  let k = 0

  function flushList() {
    if (!listItems.length) return
    const ordered = listItems[0].ordered
    const items = listItems.splice(0)
    nodes.push(
      ordered ? (
        <ol key={k++} className="my-1 list-decimal space-y-0.5 pl-5 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="pl-0.5 leading-relaxed">{parseInline(it.text)}</li>
          ))}
        </ol>
      ) : (
        <ul key={k++} className="my-1 space-y-0.5 pl-1 text-[13px]">
          {items.map((it, i) => (
            <li key={i} className="flex gap-2 leading-relaxed">
              <span className="mt-[7px] size-1.5 shrink-0 rounded-full bg-zinc-400" />
              <span>{parseInline(it.text)}</span>
            </li>
          ))}
        </ul>
      )
    )
  }

  function flushTable() {
    if (!tableLines.length) return
    const rows = tableLines.splice(0)

    const parseRow = (line: string) =>
      line.split("|").slice(1, -1).map((c) => c.trim())

    const isSep = (line: string) =>
      line.replace(/\s/g, "").replace(/[|:\-]/g, "").length === 0 && line.includes("-")

    const sepIdx = rows.findIndex(isSep)
    const headerCells = rows[0] ? parseRow(rows[0]) : []
    const bodyRows = rows
      .filter((_, i) => i !== 0 && (sepIdx === -1 || i !== sepIdx))
      .map(parseRow)
      .filter((r) => r.length > 0)

    nodes.push(
      <div key={k++} className="my-2 overflow-x-auto rounded-xl border border-border">
        <table className="w-full border-collapse text-[12px]">
          <thead>
            <tr className="bg-muted/50">
              {headerCells.map((cell, ci) => (
                <th
                  key={ci}
                  className="border-b border-border px-3 py-2 text-left font-semibold text-foreground"
                >
                  {parseInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bodyRows.map((row, ri) => (
              <tr key={ri} className={ri % 2 === 1 ? "bg-muted/20" : ""}>
                {row.map((cell, ci) => (
                  <td
                    key={ci}
                    className="border-b border-border/50 px-3 py-2 text-foreground last:border-0"
                  >
                    {parseInline(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  function flushAll() {
    flushList()
    flushTable()
  }

  for (const line of lines) {
    if (line.startsWith("```")) {
      if (!inCode) {
        flushAll()
        inCode = true
        codeLines.length = 0
      } else {
        nodes.push(
          <pre key={k++} className="my-2 overflow-x-auto rounded-xl bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
            <code>{codeLines.join("\n")}</code>
          </pre>
        )
        inCode = false
      }
      continue
    }

    if (inCode) { codeLines.push(line); continue }

    // [[ASSETS:ids:id1,id2]] — vision search results
    const idsMatch = line.match(/\[\[ASSETS:ids:([^\]]+)\]\]/)
    if (idsMatch) {
      flushAll()
      const before = line.slice(0, idsMatch.index!).trim()
      const after  = line.slice(idsMatch.index! + idsMatch[0].length).trim()
      const ids = idsMatch[1].split(",").map((s) => s.trim()).filter(Boolean)
      if (before) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(before)}</p>)
      nodes.push(<InlineAssetBlockByIds key={k++} assetIds={ids} />)
      if (after)  nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(after)}</p>)
      continue
    }

    // [[ASSET_LIST:type]] — filename bullet list from library
    const listMatch = line.match(/\[\[ASSET_LIST:([a-z]+)\]\]/)
    if (listMatch) {
      flushAll()
      const before = line.slice(0, listMatch.index!).trim()
      const after = line.slice(listMatch.index! + listMatch[0].length).trim()
      if (before) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(before)}</p>)
      nodes.push(<InlineAssetFilenameList key={k++} mediaType={listMatch[1]} />)
      if (after) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(after)}</p>)
      continue
    }

    // Inline asset block tag — [[ASSETS:type]] or [[ASSETS:type:N]]
    const assetMatch = line.match(/\[\[ASSETS:([a-z]+)(?::(\d+))?\]\]/)
    if (assetMatch) {
      flushAll()
      const before = line.slice(0, assetMatch.index!).trim()
      const after  = line.slice(assetMatch.index! + assetMatch[0].length).trim()
      const limit  = assetMatch[2] ? parseInt(assetMatch[2], 10) : 9
      if (before) nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(before)}</p>)
      nodes.push(<InlineAssetBlock key={k++} mediaType={assetMatch[1]} limit={limit} />)
      if (after)  nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(after)}</p>)
      continue
    }

    // Table line
    if (line.trimStart().startsWith("|")) {
      flushList()
      tableLines.push(line)
      continue
    } else {
      flushTable()
    }

    // Support # through ###### (models often emit #### which previously showed as raw text)
    const mathIndex = readMathBlockPlaceholder(line)
    if (mathIndex !== null && mathBlocks[mathIndex] !== undefined) {
      flushAll()
      nodes.push(<MathBlock key={k++} latex={mathBlocks[mathIndex]!} />)
      continue
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    const hr = /^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())
    const ul = line.match(/^[-*]\s+(.+)/)
    const ol = line.match(/^\d+\.\s+(.+)/)

    if (heading) {
      flushList()
      const level = heading[1]!.length
      const cls =
        level === 1
          ? "mb-1 mt-3 text-[15px] font-bold text-foreground first:mt-0"
          : level === 2
            ? "mb-0.5 mt-3 text-[14px] font-bold text-foreground first:mt-0"
            : level === 3
              ? "mb-0.5 mt-2 text-[13px] font-semibold text-foreground"
              : "mb-0.5 mt-2 text-[13px] font-semibold text-foreground"
      nodes.push(
        <p key={k++} className={cls}>
          {parseInline(heading[2]!)}
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
    } else if (line.trim() === "") {
      flushList()
    } else {
      flushList()
      nodes.push(<p key={k++} className="text-[13px] leading-relaxed">{parseInline(line)}</p>)
    }
  }

  if (inCode && codeLines.length) {
    nodes.push(
      <pre key={k++} className="my-2 overflow-x-auto rounded-xl bg-zinc-950 px-4 py-3 text-[12px] leading-relaxed text-zinc-100">
        <code>{codeLines.join("\n")}</code>
      </pre>
    )
  }
  flushAll()

  return <div className="space-y-[3px]">{nodes}</div>
}

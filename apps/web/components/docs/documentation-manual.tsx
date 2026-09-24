"use client"

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react"
import type { MouseEvent, ReactNode } from "react"
import Link from "next/link"
import { ChevronDown } from "lucide-react"
import {
  API_KEY_SCOPES,
  buildCurlMultipartUploadSnippet,
  buildNodeMultipartUploadSnippet,
  buildPythonMultipartUploadSnippet,
  buildPythonSocketSnippet,
} from "@arciin/shared"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { copyToClipboard } from "@/lib/utils/clipboard"
import { createId } from "@/lib/utils/create-id"
import { cn } from "@/lib/utils"
import { IntegrationsDocs } from "@/components/docs/integrations-docs"
import { DOC_TOC_GROUPS, flattenDocToc } from "@/lib/docs/doc-toc"

const apiBase  = process.env.NEXT_PUBLIC_API_BASE_URL  || "/api"
const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL   || "http://localhost:4000"
const publicUrl = process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL || "http://localhost:3000"
const directApiOrigin = (process.env.NEXT_PUBLIC_ARCIIN_API_ORIGIN || "http://localhost:4000").replace(/\/$/, "")
const BASE = apiBase.startsWith("http") ? apiBase : `${publicUrl}${apiBase}`

const flatToc = flattenDocToc()

// ── Language context ───────────────────────────────────────────────────────────

type Lang = "node" | "python" | "curl" | "postman"
const LangCtx = createContext<{ lang: Lang; set: (l: Lang) => void }>({ lang: "node", set: () => {} })

const LANG_LABELS: Record<Lang, string> = {
  node: "Node.js",
  python: "Python",
  curl: "curl",
  postman: "Postman",
}

// ── Primitives ─────────────────────────────────────────────────────────────────

function CodeBlock({ title, lang = "js", children }: { title?: string; lang?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    await copyToClipboard(children)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.08] bg-[#09090b] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] ring-1 ring-black/[0.06]">
      <div className="pointer-events-none absolute inset-0 rounded-xl bg-[linear-gradient(180deg,rgba(255,75,51,0.08)_0%,transparent_40%)]" aria-hidden />
      <div className="relative flex items-center justify-between border-b border-white/[0.07] bg-black/30 px-4 py-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{title ?? lang}</span>
        <button type="button" onClick={copy} className="rounded px-2 py-0.5 text-[11px] text-zinc-500 transition-colors hover:bg-white/[0.08] hover:text-zinc-300">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-4 text-[13px] leading-relaxed text-zinc-100">
        <code>{children}</code>
      </pre>
    </div>
  )
}

/** Shown when Postman tab is selected and a block has no custom `postman` text. Uses REST base from env. */
function defaultPostmanInstructions() {
  return `JSON REST base for this manual (paste as URL prefix in Postman):

${BASE}

Setup:
1. New → HTTP request.
2. Full URL = base above + path from the curl tab (e.g. …/libraries, …/auth/me). Paths are like /libraries — not /api-keys/libraries.
3. Authorization → Bearer Token → your arc_live_… key (or Headers: Authorization = Bearer …).
4. Accept: application/json.

Wrong URL (HTML login / 404): http://localhost:3000/api-keys/libraries
That path does not exist. To list libraries use:
GET ${BASE}/libraries
(scopes: libraries:read). The /api-keys routes only manage key records (admin), not library folders.`
}

/** Shows a code block only when lang matches. Falls back gracefully when no code provided. */
function MultiCode({
  node,
  python,
  curl,
  postman,
  title,
}: {
  node?: string
  python?: string
  curl?: string
  /** Postman-specific steps; if omitted, a generic guide + this manual's base URL is shown. */
  postman?: string
  title?: string
}) {
  const { lang } = useContext(LangCtx)
  const code =
    lang === "postman"
      ? (postman ?? defaultPostmanInstructions())
      : lang === "python"
        ? python
        : lang === "curl"
          ? curl
          : node
  if (!code) {
    const fallback = node ?? python ?? curl ?? postman ?? defaultPostmanInstructions()
    return <CodeBlock title={title} lang="js">{fallback}</CodeBlock>
  }
  const fileType =
    lang === "postman" ? "txt" : lang === "python" ? "python" : lang === "curl" ? "sh" : "js"
  return <CodeBlock title={title} lang={fileType}>{code}</CodeBlock>
}

function Callout({ variant, title, children }: { variant: "tip" | "warning" | "success"; title: string; children: ReactNode }) {
  const cls =
    variant === "warning" ? "border-l-amber-500 bg-amber-50" :
    variant === "success" ? "border-l-emerald-500 bg-emerald-50" :
    "border-l-primary bg-primary/[0.06]"
  return (
    <aside className={`rounded-xl border border-zinc-200/80 border-l-4 px-4 py-3 text-sm leading-relaxed shadow-sm ${cls}`}>
      <p className="font-semibold text-zinc-900">{title}</p>
      <div className="mt-1.5 text-zinc-700 [&>p+p]:mt-2">{children}</div>
    </aside>
  )
}

function DocH2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-28 flex items-center gap-3 font-heading text-[1.55rem] font-semibold tracking-tight text-zinc-900">
      <span className="h-6 w-1 shrink-0 rounded-full bg-primary/70" aria-hidden />
      {children}
    </h2>
  )
}
function DocH3({ id, children, className }: { id?: string; children: ReactNode; className?: string }) {
  return (
    <h3
      id={id}
      className={cn("scroll-mt-28 text-[15px] font-semibold tracking-tight text-zinc-900", className)}
    >
      {children}
    </h3>
  )
}
function DocP({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("text-[15px] leading-7 text-zinc-700", className)}>{children}</p>
}
function IC({ children }: { children: ReactNode }) {
  return <code className="rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[12px] text-zinc-900">{children}</code>
}
function Sep() {
  return <div className="h-px bg-gradient-to-r from-transparent via-zinc-200 to-transparent" />
}

function EndpointRow({ method, path, desc }: { method: string; path: string; desc: string }) {
  const color =
    method === "GET" ? "bg-emerald-100 text-emerald-800" :
    method === "POST" ? "bg-blue-100 text-blue-800" :
    method === "PATCH" ? "bg-amber-100 text-amber-800" :
    "bg-red-100 text-red-800"
  const withPlaceholders = path.replace(/:[a-zA-Z]+/g, "{id}")
  const pathPart = withPlaceholders.startsWith("/") ? withPlaceholders : `/${withPlaceholders}`
  return (
    <div className="flex flex-col gap-1.5 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 shadow-sm sm:flex-row sm:items-start sm:gap-3">
      <span className={`mt-0.5 w-fit shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${color}`}>{method}</span>
      <div className="min-w-0 flex-1 space-y-1">
        <span className="font-mono text-[13px] text-zinc-900">{path}</span>
        <p className="text-[12px] text-zinc-500">{desc}</p>
        <p className="break-all font-mono text-[11px] leading-relaxed text-zinc-400">
          → <span className="text-zinc-600">full URL shape:</span> {BASE}
          {pathPart}
        </p>
      </div>
    </div>
  )
}

/** Expandable list of method + full URL + copy — like Git-style “copy link” for each verb. */
function RequestUrlsCheatsheet({
  label,
  requests,
}: {
  label: string
  requests: { method: string; fullPath: string; hint?: string }[]
}) {
  const [copied, setCopied] = useState<string | null>(null)
  async function copy(text: string, key: string) {
    await copyToClipboard(text)
    setCopied(key)
    setTimeout(() => setCopied(null), 2000)
  }
  return (
    <Collapsible defaultOpen className="rounded-xl border border-zinc-200/90 bg-zinc-50/80 shadow-sm">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left text-[13px] font-semibold text-zinc-800 transition-colors hover:bg-zinc-100/80 [&[data-state=open]>svg]:rotate-180">
        {label}
        <ChevronDown className="size-4 shrink-0 text-zinc-500 transition-transform duration-200" aria-hidden />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="space-y-2 border-t border-zinc-200/80 px-4 pb-4 pt-2">
          {requests.map((req) => {
            const url = `${BASE}${req.fullPath.startsWith("/") ? req.fullPath : `/${req.fullPath}`}`
            const key = `${req.method}:${req.fullPath}`
            return (
              <div
                key={key}
                className="flex flex-col gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 sm:flex-row sm:items-start sm:justify-between sm:gap-3"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 font-mono text-[10px] font-bold uppercase",
                        req.method === "GET" && "bg-emerald-100 text-emerald-800",
                        req.method === "POST" && "bg-blue-100 text-blue-800",
                        req.method === "PATCH" && "bg-amber-100 text-amber-800",
                        req.method === "DELETE" && "bg-red-100 text-red-800",
                      )}
                    >
                      {req.method}
                    </span>
                    {req.hint ? <span className="text-[11px] text-zinc-500">{req.hint}</span> : null}
                  </div>
                  <code className="block break-all font-mono text-[12px] leading-relaxed text-zinc-800">{url}</code>
                </div>
                <button
                  type="button"
                  onClick={() => copy(url, key)}
                  className="shrink-0 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
                >
                  {copied === key ? "Copied" : "Copy URL"}
                </button>
              </div>
            )
          })}
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

// ── Language picker strip ──────────────────────────────────────────────────────

function LangPicker() {
  const { lang, set } = useContext(LangCtx)
  return (
    <div className="-mx-1 flex items-center gap-1 rounded-xl border border-zinc-200/80 bg-white/80 px-2 py-2 shadow-sm backdrop-blur-sm">
      <span className="mr-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Language</span>
      {(Object.keys(LANG_LABELS) as Lang[]).map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => set(l)}
          className={cn(
            "rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
            lang === l
              ? "bg-primary text-white shadow-sm"
              : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900",
          )}
        >
          {LANG_LABELS[l]}
        </button>
      ))}
    </div>
  )
}

// ── Event groups ──────────────────────────────────────────────────────────────

const EVENT_GROUPS: Record<string, { events: string[]; desc: string }> = {
  "Uploads":   { events: ["upload.started","upload.progress","upload.completed","upload.failed"],                                   desc: "File ingest lifecycle." },
  "Assets":    { events: ["asset.created","asset.updated","asset.moved","asset.deleted","asset.classified"],                        desc: "Asset lifecycle." },
  "Media":     { events: ["thumbnail.created","media.metadata.extracted","media.processing.completed","media.processing.failed"],   desc: "Background worker events." },
  "Libraries": { events: ["library.created","library.updated","library.scanned"],                                                   desc: "Library changes." },
  "Jobs":      { events: ["job.created","job.progress","job.completed","job.failed"],                                               desc: "BullMQ job lifecycle." },
  "Activity":  { events: ["activity.created"],                                                                                      desc: "All user and system actions." },
  "Plex":      { events: ["plex.connected","plex.sync.started","plex.sync.completed","plex.sync.failed"],                           desc: "Plex sync lifecycle (coming soon)." },
}

// ── API Playground ────────────────────────────────────────────────────────────

type HeaderRow = { id: string; key: string; value: string; enabled: boolean }

const METHOD_STYLE: Record<string, string> = {
  GET:    "text-emerald-700 bg-emerald-50 border-emerald-200",
  POST:   "text-blue-700 bg-blue-50 border-blue-200",
  PATCH:  "text-amber-700 bg-amber-50 border-amber-200",
  PUT:    "text-amber-700 bg-amber-50 border-amber-200",
  DELETE: "text-red-700 bg-red-50 border-red-200",
}

function ApiPlayground() {
  const [method, setMethod]     = useState("GET")
  const [path, setPath]         = useState("/auth/me")
  const [tab, setTab]           = useState<"headers" | "body">("headers")
  const [hdrs, setHdrs]         = useState<HeaderRow[]>([
    { id: "a1", key: "Authorization", value: "Bearer arc_live_your_key_here", enabled: true },
  ])
  const [body, setBody]         = useState('{\n  \n}')
  const [resp, setResp]         = useState<{ status: number; statusText: string; ms: number; text: string } | null>(null)
  const [sending, setSending]   = useState(false)

  const hasBody = ["POST", "PATCH", "PUT"].includes(method)

  async function send() {
    setSending(true)
    const t0 = Date.now()
    try {
      const url = `${apiBase}${path.startsWith("/") ? path : `/${path}`}`
      const reqHdrs: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" }
      for (const h of hdrs) {
        if (h.enabled && h.key.trim()) reqHdrs[h.key.trim()] = h.value.trim()
      }
      const res = await fetch(url, {
        method,
        headers: reqHdrs,
        credentials: "include",
        body: hasBody && body.trim() ? body : undefined,
      })
      const raw = await res.text()
      let pretty = raw
      try { pretty = JSON.stringify(JSON.parse(raw), null, 2) } catch { /* raw is not JSON — display as-is */ }
      setResp({ status: res.status, statusText: res.statusText, ms: Date.now() - t0, text: pretty })
    } catch (e) {
      setResp({ status: 0, statusText: e instanceof Error ? e.message : "Network error", ms: Date.now() - t0, text: "" })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      {/* URL bar */}
      <div className="flex items-center gap-2 border-b border-zinc-200 bg-zinc-50 px-3 py-2.5">
        <select
          value={method}
          onChange={e => { setMethod(e.target.value); if (!["POST","PATCH","PUT"].includes(e.target.value)) setTab("headers") }}
          className={cn("cursor-pointer rounded-lg border px-2.5 py-1.5 font-mono text-[12px] font-bold outline-none", METHOD_STYLE[method] ?? "")}
        >
          {["GET","POST","PATCH","PUT","DELETE"].map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <div className="flex flex-1 items-center overflow-hidden rounded-lg border border-zinc-200 bg-white px-3 py-1.5 focus-within:border-primary/40 focus-within:ring-1 focus-within:ring-primary/20">
          <span className="shrink-0 select-none font-mono text-[12px] text-zinc-400">{apiBase}</span>
          <input
            value={path}
            onChange={e => setPath(e.target.value)}
            onKeyDown={e => e.key === "Enter" && send()}
            className="flex-1 bg-transparent pl-0.5 font-mono text-[13px] text-zinc-900 outline-none"
            placeholder="/auth/me"
            spellCheck={false}
          />
        </div>
        <button
          type="button"
          onClick={send}
          disabled={sending}
          className="shrink-0 rounded-lg bg-primary px-4 py-1.5 text-[13px] font-semibold text-white transition-colors hover:bg-primary/90 disabled:opacity-60"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-zinc-100">
        {(["headers", ...(hasBody ? ["body"] : [])] as ("headers" | "body")[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-[12px] font-semibold capitalize transition-colors",
              tab === t ? "border-b-2 border-primary text-primary" : "text-zinc-400 hover:text-zinc-700",
            )}
          >
            {t}
            {t === "headers" && (
              <span className="ml-1.5 rounded-md bg-zinc-100 px-1 py-0.5 text-[10px] tabular-nums text-zinc-500">
                {hdrs.filter(h => h.enabled && h.key).length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Headers panel */}
      {tab === "headers" && (
        <div className="p-3">
          <table className="w-full border-separate border-spacing-y-1 text-[12px]">
            <thead>
              <tr>
                <th className="w-5 text-left" />
                <th className="pb-1 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Key</th>
                <th className="pb-1 pl-2 text-left text-[10px] font-bold uppercase tracking-wide text-zinc-400">Value</th>
                <th className="w-6" />
              </tr>
            </thead>
            <tbody>
              {hdrs.map(h => (
                <tr key={h.id} className="group">
                  <td className="pr-2">
                    <input
                      type="checkbox"
                      checked={h.enabled}
                      onChange={e => setHdrs(p => p.map(r => r.id === h.id ? { ...r, enabled: e.target.checked } : r))}
                      className="accent-primary rounded"
                    />
                  </td>
                  <td>
                    <input
                      value={h.key}
                      onChange={e => setHdrs(p => p.map(r => r.id === h.id ? { ...r, key: e.target.value } : r))}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[12px] text-zinc-700 outline-none focus:border-primary/40 focus:bg-white"
                      placeholder="Header-Name"
                    />
                  </td>
                  <td className="pl-2">
                    <input
                      value={h.value}
                      onChange={e => setHdrs(p => p.map(r => r.id === h.id ? { ...r, value: e.target.value } : r))}
                      className="w-full rounded-lg border border-zinc-200 bg-zinc-50 px-2.5 py-1.5 font-mono text-[12px] text-zinc-700 outline-none focus:border-primary/40 focus:bg-white"
                      placeholder="value"
                    />
                  </td>
                  <td className="pl-2">
                    <button
                      type="button"
                      onClick={() => setHdrs(p => p.filter(r => r.id !== h.id))}
                      className="rounded p-1 text-zinc-300 transition-colors hover:text-red-500 group-hover:text-zinc-400"
                      aria-label="Remove"
                    >×</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            type="button"
            onClick={() => setHdrs(p => [...p, { id: createId(), key: "", value: "", enabled: true }])}
            className="mt-1 text-[11px] font-medium text-primary hover:underline"
          >
            + Add header
          </button>
        </div>
      )}

      {/* Body panel */}
      {tab === "body" && hasBody && (
        <div className="p-3">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            rows={7}
            spellCheck={false}
            className="w-full rounded-xl border border-zinc-200 bg-zinc-950 px-4 py-3 font-mono text-[12px] leading-relaxed text-zinc-100 outline-none focus:border-primary/40"
            placeholder='{"key": "value"}'
          />
        </div>
      )}

      {/* Response */}
      {resp && (
        <div className="border-t border-zinc-200">
          <div className="flex items-center gap-3 border-b border-zinc-800 bg-zinc-950 px-4 py-2">
            <span className={cn(
              "text-[12px] font-bold tabular-nums",
              resp.status >= 200 && resp.status < 300 ? "text-emerald-400" :
              resp.status >= 400 ? "text-red-400" : "text-zinc-400",
            )}>
              {resp.status || "—"} {resp.statusText}
            </span>
            <span className="text-[11px] text-zinc-500">{resp.ms} ms</span>
          </div>
          <pre className="overflow-x-auto bg-zinc-950 p-4 text-[12px] leading-relaxed text-zinc-100">
            <code>{resp.text || "(empty response)"}</code>
          </pre>
        </div>
      )}
    </div>
  )
}

/** Dashboard content scrolls in an inner `overflow-y-auto` pane, not the window — default `#hash` links do not move that pane. */
function nearestScrollableAncestor(start: HTMLElement | null): HTMLElement | null {
  let el: HTMLElement | null = start?.parentElement ?? null
  while (el) {
    const { overflowY } = getComputedStyle(el)
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") {
      return el
    }
    el = el.parentElement
  }
  return null
}

// ── Main export ───────────────────────────────────────────────────────────────

export function DocumentationManual() {
  const [activeId, setActiveId] = useState("overview")
  const [lang, setLang] = useState<Lang>("node")
  const articleRef = useRef<HTMLElement>(null)

  const scrollToSection = useCallback((id: string, smooth = true) => {
    const el = document.getElementById(id)
    if (!el) return
    el.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" })
    setActiveId(id)
    const nextHash = `#${id}`
    if (typeof window !== "undefined" && window.location.hash !== nextHash) {
      window.history.replaceState(null, "", nextHash)
    }
  }, [])

  const onTocClick = useCallback(
    (id: string, e: MouseEvent<HTMLAnchorElement>) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
      e.preventDefault()
      scrollToSection(id)
    },
    [scrollToSection],
  )

  useEffect(() => {
    const article = articleRef.current
    if (!article) return

    const firstHeading = article.querySelector<HTMLElement>("h2[id]")
    const scrollRoot = nearestScrollableAncestor(firstHeading ?? article)

    const pickActive = () => {
      const headings = Array.from(article.querySelectorAll<HTMLElement>("h2[id]"))
      if (headings.length === 0) return

      const offset = 96
      const line = scrollRoot ? scrollRoot.getBoundingClientRect().top + offset : offset

      let current = headings[0].id
      for (const h of headings) {
        if (h.getBoundingClientRect().top <= line) current = h.id
        else break
      }
      setActiveId((prev) => (prev === current ? prev : current))

      if (typeof window !== "undefined") {
        const nextHash = `#${current}`
        if (window.location.hash !== nextHash) {
          window.history.replaceState(null, "", nextHash)
        }
      }
    }

    const target: HTMLElement | Window = scrollRoot ?? window
    target.addEventListener("scroll", pickActive, { passive: true })
    window.addEventListener("resize", pickActive)

    const validSectionIds = new Set(flatToc.map((t) => t.id))
    const legacyHash: Record<string, string> = {
      "plex-media-server": "plex-same-server",
    }
    const hash = typeof window !== "undefined" ? window.location.hash.slice(1) : ""
    const resolvedHash = hash ? (legacyHash[hash] ?? hash) : ""
    if (resolvedHash && validSectionIds.has(resolvedHash)) {
      queueMicrotask(() => scrollToSection(resolvedHash, false))
    }

    pickActive()

    return () => {
      target.removeEventListener("scroll", pickActive)
      window.removeEventListener("resize", pickActive)
    }
  }, [scrollToSection])

  return (
    <LangCtx.Provider value={{ lang, set: setLang }}>
      <div className="xl:grid xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] xl:items-start xl:gap-12">

        {/* ── TOC sidebar ─────────────────────────────────────────────────── */}
        <nav aria-label="On this page" className="mb-10 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white/80 p-4 text-sm shadow-sm ring-1 ring-black/[0.04] backdrop-blur-sm xl:sticky xl:top-8 xl:mb-0 xl:block">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">On this page</p>
          <ul className="space-y-3">
            {DOC_TOC_GROUPS.map((group) => (
              <li key={group.label}>
                <p className="mb-1 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                  {group.label}
                </p>
                <ul className="space-y-0.5">
                  {group.items.map(({ id, label }) => {
                    const active = activeId === id
                    return (
                      <li
                        key={id}
                        className={cn(
                          "rounded-lg border-l-[3px] transition-colors",
                          active ? "border-primary bg-primary/[0.1]" : "border-transparent hover:bg-zinc-100/70",
                        )}
                      >
                        <a
                          href={`#${id}`}
                          onClick={(e) => onTocClick(id, e)}
                          className={cn(
                            "block rounded-r-md py-2 pl-3 pr-2 text-[13px] transition-colors",
                            active ? "font-semibold text-primary" : "text-zinc-600 hover:text-zinc-900",
                          )}
                        >
                          {label}
                        </a>
                      </li>
                    )
                  })}
                </ul>
              </li>
            ))}
          </ul>
          <p className="mt-5 border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-400">
            Values in <span className="font-mono">code blocks</span> use this instance&apos;s env vars.
          </p>
        </nav>

        {/* ── Right column: lang picker + article ─────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <LangPicker />

          {/* ── Article ────────────────────────────────────────────────────── */}
          <article ref={articleRef} className="space-y-12 border-t border-zinc-200/80 pt-5 xl:border-t-0 xl:pt-0">

            {/* Mobile pill nav */}
            <nav className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-4 xl:hidden">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Jump to</p>
              <div className="flex flex-wrap gap-2">
                {flatToc.map(({ id, label }) => {
                  const active = activeId === id
                  return (
                    <a
                      key={id}
                      href={`#${id}`}
                      onClick={(e) => onTocClick(id, e)}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs font-medium shadow-sm transition-colors",
                        active
                          ? "border-primary/50 bg-primary/[0.12] text-primary"
                          : "border-zinc-200 bg-white text-zinc-700 hover:border-primary/30 hover:text-primary",
                      )}
                    >
                      {label}
                    </a>
                  )
                })}
              </div>
            </nav>

          {/* ── Overview ──────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="overview">Overview</DocH2>
            <DocP>Arciin is a self-hosted private file, library, and media management platform. The web app talks to a separate <strong className="text-zinc-900">Fastify API</strong> and optional <strong className="text-zinc-900">BullMQ workers</strong>. This manual covers every integration surface: REST, uploads, app databases, realtime events, and webhooks.</DocP>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2.5 text-[11px] font-bold uppercase tracking-wide text-zinc-400">Architecture</div>
              <pre className="overflow-auto p-4 font-mono text-[12px] leading-7 text-zinc-600">{`Browser / your script
  ↓ HTTPS
  ┌─────────────────────────────┐
  │   Next.js web app  :3000    │
  └──────────────┬──────────────┘
                 │ REST / Socket.IO
  ┌──────────────▼──────────────┐
  │   Fastify API       :4000   │
  └──────┬────────────┬─────────┘
         │ Prisma     │ BullMQ
  ┌──────▼──┐   ┌─────▼──────┐
  │ Postgres│   │   Redis    │
  └─────────┘   └────┬───────┘
                     │
              ┌──────▼──────┐
              │   Workers   │
              └─────────────┘`}</pre>
            </div>
          </section>

          <Sep />

          {/* ── Install & upgrade ─────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="upgrading">Install &amp; upgrade</DocH2>
            <DocP>
              First-time setup uses <IC>install.sh</IC> from the repository root (dependencies, <IC>.env</IC>, migrations, storage). After that, when you pull changes or edit the server yourself, rebuild and restart the three PM2 apps.
            </DocP>
            <CodeBlock title="Upgrade after git pull" lang="sh">{`cd /path/to/arciin
git pull
pnpm install
pnpm exec prisma migrate deploy
pnpm build
pm2 restart arciin-api arciin-web arciin-worker`}</CodeBlock>
            <DocP>
              <IC>pnpm build</IC> compiles the Next.js web app, Fastify API, and worker. Restart <strong className="text-zinc-900">arciin-api</strong>, <strong className="text-zinc-900">arciin-web</strong>, and <strong className="text-zinc-900">arciin-worker</strong> so each process loads the new output. If you only changed <IC>.env</IC>, restart is enough — no build required.
            </DocP>
            <CodeBlock title="Check processes" lang="sh">{`pm2 status
pm2 logs arciin-api --lines 50`}</CodeBlock>
          </section>

          <Sep />

          {/* ── URLs ──────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="urls">URLs &amp; environment</DocH2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Web app",       value: publicUrl, note: "Browser UI. Session cookie is set here after email/password login." },
                { label: "REST API base", value: BASE,      note: "Use this string as PREFIX: every path in this manual is appended to it (e.g. base + \"/libraries\")." },
                { label: "Direct API (optional)", value: `${directApiOrigin}/api`, note: "Bypass Next.js by calling Fastify on its port when the proxy is not involved.", wide: true },
                { label: "Socket.IO server", value: socketUrl, note: "Connect socket.io-client to this origin.", wide: true },
              ].map((r) => (
                <div key={r.label} className={cn("rounded-xl border border-zinc-200 bg-white p-4 shadow-sm", (r as { label: string; value: string; note: string; wide?: boolean }).wide && "sm:col-span-2")}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{r.label}</p>
                  <p className="mt-1 break-all font-mono text-[13px] text-zinc-800">{r.value}</p>
                  <p className="mt-1.5 text-[12px] text-zinc-500">{r.note}</p>
                </div>
              ))}
            </div>
            <CodeBlock title=".env" lang="sh">{`NEXT_PUBLIC_API_BASE_URL=/api
NEXT_PUBLIC_ARCIIN_API_ORIGIN=http://localhost:4000
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_ARCIIN_PUBLIC_URL=http://localhost:3000
ARCIIN_API_URL=http://localhost:4000
DATABASE_URL=postgresql://user:pass@localhost:5432/arciin
REDIS_URL=redis://localhost:6379
SESSION_SECRET=replace-with-64-char-random-string`}</CodeBlock>
          </section>

          <Sep />

          {/* ── External apps ─────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="external-apps">Your website, another server &amp; API keys</DocH2>
            <DocP>
              <strong className="text-zinc-900">You do not use your Arciin email/password inside your own app.</strong> That login only exists for humans using the Arciin web UI in a browser (it sets an httpOnly session cookie on the Arciin origin).
            </DocP>
            <DocP>
              To call Arciin from <strong className="text-zinc-900">your website backend, a script, or curl</strong>, create an <strong className="text-zinc-900">API key</strong> once in Arciin (<Link href="/developer/api-keys" className="font-medium text-primary underline-offset-4 hover:underline">Developer → API Keys</Link>), choose the <strong className="text-zinc-900">scopes</strong> you need (e.g. <IC>libraries:read</IC>, <IC>assets:read</IC>, <IC>uploads:create</IC>), and store the raw key server-side—same idea as a Supabase service role or Firebase server key: one secret represents that integration.
            </DocP>
            <Callout variant="warning" title='Why you saw "Sign in" or 401'>
              <p>
                Every JSON API request must send <strong className="text-zinc-900">either</strong> the browser session cookie (only works from the Arciin web app, same origin) <strong className="text-zinc-900">or</strong> an <IC>Authorization: Bearer arc_…</IC> header with a valid API key. If you paste only <IC>http://IP:4000/api/libraries</IC> in the browser address bar, there is <strong className="text-zinc-900">no</strong> cookie and <strong className="text-zinc-900">no</strong> Bearer header—you will get 401. That is expected: use curl/your server with the header instead.
              </p>
            </Callout>
            <DocH3>Copy-paste: list libraries from another machine (LAN IP)</DocH3>
            <DocP>
              Replace <IC>YOUR_KEY</IC> with your API key, <IC>192.168.x.x</IC> with your server IP. The REST prefix is always <IC>/api</IC> then the path from this manual (e.g. <IC>/libraries</IC>).
            </DocP>
            <CodeBlock title="curl (direct to Fastify)" lang="sh">{`curl -sS -H "Authorization: Bearer YOUR_KEY" \\
  -H "Accept: application/json" \\
  "${directApiOrigin}/api/libraries"`}</CodeBlock>
            <CodeBlock title="curl (via Next.js proxy on :3000, same as browser origin)" lang="sh">{`curl -sS -H "Authorization: Bearer YOUR_KEY" \\
  -H "Accept: application/json" \\
  "${publicUrl}/api/libraries"`}</CodeBlock>
            <DocP>
              Your separate product’s <strong className="text-zinc-900">user accounts</strong> (Google login, etc.) stay in <em>your</em> app. Arciin does not replace that. The API key ties automation to <strong className="text-zinc-900">one Arciin user</strong> on the server—the owner of the key—so keep keys on the server and never ship them to browsers if the key can write or upload.
            </DocP>
          </section>

          <Sep />
          <section className="space-y-5">
            <DocH2 id="playground">API explorer</DocH2>
            <DocP>Try any endpoint directly from this page. Paste your API key in the Authorization header, pick a method, enter a path relative to the base URL, and hit <strong className="text-zinc-900">Send</strong>. The response appears below with status code and latency.</DocP>
            <Callout variant="tip" title="Same-origin requests">
              Requests go from your browser to the API server. Session cookies are included automatically — no API key needed for endpoints that accept cookie auth.
            </Callout>
            <ApiPlayground />
          </section>

          <Sep />

          {/* ── Auth ──────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="rest">Authentication</DocH2>
            <DocP>Two auth mechanisms are supported. <strong className="text-zinc-900">Session cookie</strong> for the Arciin web UI only (same origin as the app). <strong className="text-zinc-900">API key Bearer token</strong> for scripts, curl, and your own backends—this is how you integrate without &quot;logging in&quot; with a password on every request.</DocP>

            <DocH3>Reusable helper (start here)</DocH3>
            <DocP className="text-zinc-600">
              Below, <IC>{BASE}</IC> is your <strong className="text-zinc-900">REST API base</strong> (same value as in &quot;URLs &amp; environment&quot;). Every request is <IC>{BASE}</IC> + path, e.g. <IC>{BASE}/auth/me</IC>.
            </DocP>
            <RequestUrlsCheatsheet
              label="Copy full URL — GET current user"
              requests={[
                { method: "GET", fullPath: "/auth/me", hint: "Bearer API key or session cookie" },
              ]}
            />
            <MultiCode
              title="Helper — paste once, use everywhere"
              postman={`Environment: arciin_base = ${BASE}, arciin_key = arc_live_…

GET {{arciin_base}}/auth/me  ·  Authorization: Bearer {{arciin_key}}

List libraries: GET {{arciin_base}}/libraries`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}"; // same as docs "REST API base"

// One-off: full URL is \`\${BASE}/auth/me\`
const res = await fetch(\`\${BASE}/auth/me\`, {
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "application/json",
  },
});
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body));
console.log(body.data.user.name);

// Reusable helper (path only, still uses full BASE above):
async function arciin(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Authorization: \`Bearer \${API_KEY}\`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const j = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(j));
  return j;
}
// Example full URLs: \`\${BASE}/libraries\`, \`\${BASE}/assets\` …`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"  # full REST base — request URL is always API + path

# One-off: requests.get("http://localhost:3000/api/auth/me") style
r = requests.get(
    f"{API}/auth/me",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
    timeout=60,
)
r.raise_for_status()
print(r.json()["data"]["user"]["name"])

# Session helper
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

def arciin(method, path, **kwargs):
    r = s.request(method, API + path, **kwargs)
    r.raise_for_status()
    return r.json()`}
              curl={`# Full URL for "who am I" is: ${BASE}/auth/me
export ARCIIN_KEY="arc_live_your_key_here"
curl -sS \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  "${BASE}/auth/me" | jq .

# Reuse base for other routes (same as docs REST base):
export API="${BASE}"

arc() {
  curl -sS \\
    -H "Authorization: Bearer $ARCIIN_KEY" \\
    -H "Accept: application/json" \\
    -H "Content-Type: application/json" \\
    "$@"
}

arc "$API/auth/me" | jq .data.user.name`}
            />

            <DocH3>Login with email + password (browser session)</DocH3>
            <MultiCode
              postman={`Email/password login sets a cookie — in Postman use the Cookie jar, not Bearer:

1. POST ${BASE}/auth/login
   Body → raw JSON: {"email":"…","password":"…"}
2. Postman saves cookies for the host if "Automatically follow redirects" / cookies enabled.
3. GET ${BASE}/auth/me with no Bearer header — cookie sent.

For automation prefer API keys (Bearer) instead of scraping cookies.`}
              node={`// Browser only — sets httpOnly session cookie
await fetch("${BASE}/auth/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: "admin@example.com", password: "secret" }),
});

// Subsequent calls send cookie automatically
const me = await fetch("${BASE}/auth/me", { credentials: "include" });`}
              python={`import requests

s = requests.Session()
s.post("${BASE}/auth/login",
    json={"email": "admin@example.com", "password": "secret"})

# Cookie is attached automatically
me = s.get("${BASE}/auth/me").json()
print(me["data"]["user"]["name"])`}
              curl={`# Same REST base as the rest of this manual:
export API="${BASE}"

# POST full URL: $API/auth/login
curl -c cookies.txt -sS -X POST "$API/auth/login" \\
  -H "Content-Type: application/json" \\
  -d '{"email":"admin@example.com","password":"secret"}'

# GET full URL: $API/auth/me (cookie sent via -b)
curl -sS -b cookies.txt "$API/auth/me" | jq .`}
            />
            <Callout variant="warning" title="Never paste live session cookies into chat or logs">
              Session tokens grant full UI access. Prefer API keys for automation so you can scope and rotate access.
            </Callout>
          </section>

          <Sep />

          {/* ── API Keys ──────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="api-keys">API keys</DocH2>
            <DocP>Create scoped keys under <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/developer/api-keys">API keys</Link>. The raw secret is shown once — store it immediately.</DocP>
            <div className="space-y-2">
              <EndpointRow method="GET"    path="/api-keys"          desc="List all keys (prefix + scopes, secret never returned)" />
              <EndpointRow method="POST"   path="/api-keys"          desc="Create a key — rawKey returned once" />
              <EndpointRow method="POST"   path="/api-keys/:id/rotate" desc="Issue a new secret, invalidate the old one" />
              <EndpointRow method="DELETE" path="/api-keys/:id"      desc="Revoke permanently" />
            </div>

            <DocP className="text-zinc-600">
              Managing keys is often done from the UI; from scripts you call <IC>POST {BASE}/api-keys</IC> with an <strong className="text-zinc-900">admin session cookie</strong> or a key that already has permission to create keys.
            </DocP>
            <RequestUrlsCheatsheet
              label="Copy full URLs — API keys admin routes"
              requests={[
                { method: "GET", fullPath: "/api-keys", hint: "List keys" },
                { method: "POST", fullPath: "/api-keys", hint: "Create — body: name, scopes" },
                { method: "DELETE", fullPath: "/api-keys/{keyId}", hint: "Revoke — substitute id" },
              ]}
            />

            <MultiCode
              title="Create an API key"
              postman={`POST ${BASE}/api-keys
Authorization: Bearer YOUR_ADMIN_OR_SESSION — creating keys usually needs a logged-in admin; from Postman you can use cookie session after login, or call from the app UI.

Body (raw JSON):
{
  "name": "My integration",
  "scopes": ["libraries:read", "uploads:create", "assets:read"]
}

Response: copy data.rawKey once.

Then use that key as Bearer on all other requests (GET ${BASE}/libraries, etc.).`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_admin_or_existing_key";
const BASE = "${BASE}";
const auth = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
  "Content-Type": "application/json",
} as const;

// POST — full URL: \`\${BASE}/api-keys\`
const res = await fetch(\`\${BASE}/api-keys\`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({
    name: "Uploader bot",
    scopes: ["uploads:create", "assets:read"],
  }),
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const { data } = json;
console.log(data.rawKey);  // "arc_live_abc…" — save this now
console.log(data.prefix);`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_admin_or_existing_key")
API = "${BASE}"  # full URL prefix

# POST — request URL = f"{API}/api-keys"
r = requests.post(
    f"{API}/api-keys",
    headers={
        "Authorization": f"Bearer {API_KEY}",
        "Accept": "application/json",
        "Content-Type": "application/json",
    },
    json={
        "name": "Uploader bot",
        "scopes": ["uploads:create", "assets:read"],
    },
    timeout=60,
)
r.raise_for_status()
data = r.json()["data"]
print(data["rawKey"])
print(data["prefix"])`}
              curl={`export ARCIIN_KEY="arc_live_admin_or_existing_key"
export API="${BASE}"

# POST full URL: $API/api-keys
curl -sS -X POST "$API/api-keys" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"Uploader bot","scopes":["uploads:create","assets:read"]}' \\
  | jq '{key:.data.rawKey,prefix:.data.prefix}'`}
            />

            <DocH3>Available scopes</DocH3>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {API_KEY_SCOPES.map((scope) => (
                <div key={scope} className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary/60" />
                  <code className="font-mono text-[12px] text-zinc-800">{scope}</code>
                </div>
              ))}
            </div>
          </section>

          <Sep />

          {/* ── Libraries ─────────────────────────────────────────────────── */}
          <section className="space-y-8">
            <DocH2 id="libraries">Libraries &amp; folders</DocH2>
            <DocP>
              Arciin ships with <strong className="text-zinc-900">five fixed libraries</strong>. You do{" "}
              <strong className="text-zinc-900">not</strong> create new top-level libraries through the API — you{" "}
              <strong className="text-zinc-900">organize inside them</strong> with <strong className="text-zinc-900">folders</strong>, then upload or move assets.
            </DocP>

            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white text-[13px] shadow-sm">
              <div className="border-b border-zinc-100 bg-zinc-50 px-4 py-2 text-[11px] font-bold uppercase tracking-wide text-zinc-500">
                Default libraries (stable <IC>slug</IC> · resolve <IC>id</IC> via <IC>GET /libraries</IC>, then <IC>targetLibraryId</IC> on <IC>POST /uploads</IC>)
              </div>
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-zinc-100 text-[11px] uppercase tracking-wide text-zinc-500">
                    <th className="px-4 py-2 font-semibold">Library</th>
                    <th className="px-4 py-2 font-semibold">slug</th>
                    <th className="px-4 py-2 font-semibold">Typical use</th>
                  </tr>
                </thead>
                <tbody className="text-zinc-800">
                  {[
                    ["Videos", "videos", "Video files; optional subfolders (e.g. year, project)."],
                    ["Images", "images", "Photos & image assets."],
                    ["Music", "music", "Audio tracks & albums."],
                    ["Documents", "documents", "PDFs, docs, archives."],
                    ["Inbox", "inbox", "Unclassified or catch-all uploads."],
                  ].map(([name, slug, note]) => (
                    <tr key={slug} className="border-b border-zinc-50 last:border-0">
                      <td className="px-4 py-2.5 font-medium">{name}</td>
                      <td className="px-4 py-2.5 font-mono text-[12px] text-primary">{slug}</td>
                      <td className="px-4 py-2.5 text-zinc-600">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Callout variant="warning" title="POST /libraries is disabled">
              <p>
                Calling <IC>POST {BASE}/libraries</IC> returns <strong className="text-zinc-900">403</strong> with code{" "}
                <IC>LIBRARY_CREATION_DISABLED</IC>. Use folder routes under an existing library instead.
              </p>
            </Callout>

            <Callout variant="warning" title="403 FORBIDDEN — API key missing scope">
              <p>
                If <IC>GET …/libraries</IC> returns <IC>{"This API key is missing a required scope."}</IC>, add{" "}
                <IC>libraries:read</IC> on your key. Folder create/delete/rename needs <IC>libraries:write</IC>. Edit keys under{" "}
                <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/developer/api-keys">
                  Developer → API keys
                </Link>
                .
              </p>
            </Callout>

            <div className="space-y-2 rounded-xl border border-zinc-100 bg-zinc-50/50 p-3">
              <p className="text-[12px] font-semibold text-zinc-700">Quick reference — library &amp; folder routes</p>
              <EndpointRow method="GET"    path="/libraries"             desc="List the five libraries (+ counts). Scope: libraries:read" />
              <EndpointRow method="GET"    path="/libraries/:libraryId" desc="One library by id. Scope: libraries:read" />
              <EndpointRow method="POST"   path="/libraries"            desc="Disabled — returns 403 LIBRARY_CREATION_DISABLED" />
              <EndpointRow method="PATCH"  path="/libraries/:libraryId" desc="Update metadata (advanced). Scope: libraries:write" />
              <EndpointRow method="DELETE" path="/libraries/:libraryId" desc="Only non-default / legacy custom libraries; defaults return 409. Scope: libraries:write" />
              <EndpointRow method="GET"    path="/libraries/:libraryId/folders" desc="List folders in that library. Scope: libraries:read" />
              <EndpointRow method="POST"   path="/libraries/:libraryId/folders" desc="Create folder (optional parentFolderId). Scope: libraries:write" />
              <EndpointRow method="PATCH"  path="/folders/:folderId"    desc="Rename folder. Scope: libraries:write" />
              <EndpointRow method="DELETE" path="/folders/:folderId"   desc="Soft-delete folder (and descendants). Scope: libraries:write" />
            </div>

            <Callout variant="warning" title="Postman: wrong URL">
              <p>
                <IC>http://localhost:3000/api-keys/libraries</IC> is not a JSON library route. Use <IC>GET {BASE}/libraries</IC> with Bearer + <IC>libraries:read</IC>.
              </p>
            </Callout>

            <DocP className="text-zinc-600">
              <strong className="text-zinc-900">REST base</strong> for all examples: <IC>{BASE}</IC> (every path is <IC>{BASE}/…</IC>).
            </DocP>

            <RequestUrlsCheatsheet
              label="Copy full URLs — common library &amp; folder calls"
              requests={[
                { method: "GET", fullPath: "/libraries", hint: "libraries:read" },
                { method: "GET", fullPath: "/libraries/{libraryId}/folders", hint: "libraries:read" },
                { method: "POST", fullPath: "/libraries/{libraryId}/folders", hint: "libraries:write — JSON body" },
                { method: "PATCH", fullPath: "/folders/{folderId}", hint: "libraries:write" },
                { method: "DELETE", fullPath: "/folders/{folderId}", hint: "libraries:write" },
              ]}
            />

            <DocH3>Find a library id from its slug</DocH3>
            <DocP>
              Folder routes need <IC>libraryId</IC> (a CUID/UUID from your instance). List libraries once, then pick by <IC>slug</IC> (e.g. <IC>videos</IC>).
            </DocP>
            <EndpointRow method="GET" path="/libraries" desc="Returns data[] with id, name, slug, assetCount, …" />
            <MultiCode
              title="GET /libraries — resolve Videos"
              postman={`GET ${BASE}/libraries
Authorization: Bearer {{key}} (scope libraries:read)`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const res = await fetch(\`\${BASE}/libraries\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const videos = json.data.find((l) => l.slug === "videos");
console.log(videos.id); // use as libraryId below`}
              python={`import os, requests
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
r = requests.get(f"{API}/libraries", headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})
r.raise_for_status()
videos = next(l for l in r.json()["data"] if l["slug"] == "videos")
print(videos["id"])`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here" API="${BASE}"
curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" \\
  "$API/libraries" | jq '.data[] | select(.slug=="videos") | .id'`}
            />

            <DocH3>List folders inside a specific library</DocH3>
            <DocP>
              After you have <IC>libraryId</IC>, list its folder tree. Response order follows <IC>pathCache</IC>.
            </DocP>
            <EndpointRow method="GET" path="/libraries/:libraryId/folders" desc="Scope: libraries:read" />
            <MultiCode
              title="GET /libraries/{libraryId}/folders"
              postman={`GET ${BASE}/libraries/{{library_id}}/folders`}
              node={`// LIB_ID = id from GET /libraries (e.g. videos library)
const LIB_ID = "paste-library-id";
const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const res = await fetch(\`\${BASE}/libraries/\${LIB_ID}/folders\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
console.log(JSON.stringify(await res.json(), null, 2));`}
              python={`import os, requests
API = "${BASE}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
LIB_ID = "paste-library-id"
r = requests.get(
    f"{API}/libraries/{LIB_ID}/folders",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
)
print(r.json())`}
              curl={`curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" \\
  "$API/libraries/$LIB_ID/folders" | jq .`}
            />

            <DocH3>Create a folder inside a library (or inside another folder)</DocH3>
            <DocP>
              <IC>POST {BASE}/libraries/&lt;libraryId&gt;/folders</IC> with JSON <IC>{"{ \"name\": \"2024\" }"}</IC> creates a root-level folder. Optional{" "}
              <IC>parentFolderId</IC>: another folder&apos;s id in the same library to nest under; omit it or send <IC>null</IC> for the library root.
            </DocP>
            <EndpointRow method="POST" path="/libraries/:libraryId/folders" desc='Body: { name, parentFolderId? }. Scope: libraries:write' />
            <MultiCode
              title="POST /libraries/{libraryId}/folders"
              postman={`POST ${BASE}/libraries/{{library_id}}/folders
Body: { "name": "2024" } or { "name": "raw", "parentFolderId": "{{parent_folder_id}}" }`}
              node={`import fs from "node:fs";

const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const auth = { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json", "Content-Type": "application/json" } as const;

const libs = (await (await fetch(\`\${BASE}/libraries\`, { headers: auth })).json()).data;
const lib = libs.find((l) => l.slug === "videos");
const res = await fetch(\`\${BASE}/libraries/\${lib.id}/folders\`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ name: "2024" }), // or { name: "raw", parentFolderId: "…" }
});
const json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const folder = json.data;
console.log(folder.id, folder.pathCache);`}
              python={`import os, requests
API = "${BASE}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
h = {"Authorization": f"Bearer {API_KEY}", "Accept": "application/json", "Content-Type": "application/json"}
lib = next(l for l in requests.get(f"{API}/libraries", headers=h).json()["data"] if l["slug"] == "videos")
r = requests.post(f"{API}/libraries/{lib['id']}/folders", headers=h, json={"name": "2024"})
r.raise_for_status()
print(r.json()["data"]["pathCache"])`}
              curl={`VID=$(curl -sS -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json" "$API/libraries" | jq -r '.data[]|select(.slug=="videos")|.id')
curl -sS -X POST "$API/libraries/$VID/folders" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"2024"}' | jq .data`}
            />

            <DocH3>Rename a folder</DocH3>
            <DocP>
              Use the folder&apos;s <IC>id</IC> from list or create response — not the library id.
            </DocP>
            <EndpointRow method="PATCH" path="/folders/:folderId" desc='Body JSON: {"name":"New name"}. Scope: libraries:write' />
            <MultiCode
              title="PATCH /folders/{folderId}"
              postman={`PATCH ${BASE}/folders/{{folder_id}}
Body: { "name": "Renamed" }`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const FOLDER_ID = "paste-folder-id";
const res = await fetch(\`\${BASE}/folders/\${FOLDER_ID}\`, {
  method: "PATCH",
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({ name: "Renamed" }),
});
console.log(await res.json());`}
              python={`import os, requests
API = "${BASE}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
FID = "paste-folder-id"
requests.patch(
    f"{API}/folders/{FID}",
    headers={"Authorization": f"Bearer {API_KEY}", "Content-Type": "application/json"},
    json={"name": "Renamed"},
).raise_for_status()`}
              curl={`curl -sS -X PATCH "$API/folders/$FOLDER_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Content-Type: application/json" \\
  -d '{"name":"Renamed"}' | jq .`}
            />

            <DocH3>Delete a folder you created</DocH3>
            <DocP>
              <IC>DELETE</IC> soft-deletes the folder and any child folders under the same path prefix. Ensure assets are moved or deleted first if your policy requires empty folders only.
            </DocP>
            <EndpointRow method="DELETE" path="/folders/:folderId" desc="Scope: libraries:write" />
            <MultiCode
              title="DELETE /folders/{folderId}"
              postman={`DELETE ${BASE}/folders/{{folder_id}}`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const FOLDER_ID = "paste-folder-id";
const res = await fetch(\`\${BASE}/folders/\${FOLDER_ID}\`, {
  method: "DELETE",
  headers: { Authorization: \`Bearer \${API_KEY}\`, Accept: "application/json" },
});
console.log(await res.json());`}
              python={`import os, requests
API = "${BASE}"
API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
FID = "paste-folder-id"
requests.delete(
    f"{API}/folders/{FID}",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
).raise_for_status()`}
              curl={`curl -sS -X DELETE "$API/folders/$FOLDER_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Accept: application/json"`}
            />

            <DocH3>Upload files into a library</DocH3>
            <DocP>
              Uploads do not use <IC>libraryId</IC> in the first step — they use <IC>librarySlug</IC> (e.g. <IC>videos</IC>, <IC>inbox</IC>). Optional <IC>folderId</IC> targets a folder inside that library. See the full three-step flow (initiate → PUT bytes → complete) under{" "}
              <a
                href="#uploads"
                className="font-medium text-primary underline-offset-4 hover:underline"
                onClick={(e) => {
                  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
                  e.preventDefault()
                  scrollToSection("uploads")
                }}
              >
                File uploads
              </a>
              .
            </DocP>
            <DocP className="text-zinc-600">
              Typical <IC>POST {BASE}/uploads</IC> body fields: <IC>filename</IC>, <IC>size</IC>, <IC>librarySlug</IC> (<IC>videos</IC> | <IC>images</IC> | <IC>music</IC> | <IC>documents</IC> | <IC>inbox</IC>), optional <IC>folderId</IC>.
            </DocP>
          </section>

          <Sep />

          {/* ── Assets ────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="assets">Assets</DocH2>
            <DocP>An asset is any stored file. Assets belong to a library and optionally to a folder. Use query parameters to filter and paginate.</DocP>
            <div className="space-y-2">
              <EndpointRow method="GET"    path="/assets"                   desc="List — ?libraryId= ?folderId= ?page= ?limit=" />
              <EndpointRow method="GET"    path="/assets/:id"               desc="Get a single asset with full metadata" />
              <EndpointRow method="PATCH"  path="/assets/:id"               desc="Update title, description, tags" />
              <EndpointRow method="POST"   path="/assets/:id/move"          desc="Move to a different library or folder" />
              <EndpointRow method="GET"    path="/assets/:id/thumbnail"     desc="Redirect to thumbnail image" />
              <EndpointRow method="GET"    path="/assets/:id/download"      desc="Redirect to raw file" />
              <EndpointRow method="DELETE" path="/assets/:id"               desc="Soft-delete an asset" />
            </div>

            <DocP className="text-zinc-600">
              All asset routes are <IC>{BASE}/assets</IC> and <IC>{BASE}/assets/&lt;id&gt;/…</IC>. Filtering uses query strings on the list URL.
            </DocP>
            <RequestUrlsCheatsheet
              label="Copy full URLs — common asset calls"
              requests={[
                { method: "GET", fullPath: "/assets?libraryId={libraryId}&page=1&limit=20", hint: "List — substitute libraryId" },
                { method: "GET", fullPath: "/assets/{assetId}/download", hint: "Download file (redirect)" },
                { method: "PATCH", fullPath: "/assets/{assetId}", hint: "Update title / description" },
                { method: "POST", fullPath: "/assets/{assetId}/move", hint: "Move to another library or folder" },
              ]}
            />

            <MultiCode
              title="List assets (paginated)"
              postman={`GET {{base}}/assets?libraryId={{library_id}}&page=1&limit=20
Authorization: Bearer {{key}} (needs assets:read)`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const videoLibId = "REPLACE_WITH_LIBRARY_UUID";
const auth = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
} as const;

const q = new URLSearchParams({
  libraryId: videoLibId,
  page: "1",
  limit: "20",
});
// GET full URL: \`\${BASE}/assets?\${q}\`
const res = await fetch(\`\${BASE}/assets?\${q}\`, { headers: auth });
const body = await res.json();
if (!res.ok) throw new Error(JSON.stringify(body));
const { data, meta } = body;
data.forEach((a) => console.log(a.title, a.mimeType, a.size));
console.log(\`Page \${meta.page} of \${meta.pageCount}\`);`}
              python={`import os, requests
from urllib.parse import urlencode

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
video_lib_id = "REPLACE_WITH_LIBRARY_UUID"

params = urlencode({"libraryId": video_lib_id, "page": 1, "limit": 20})
# GET request URL = f"{API}/assets?{params}"
r = requests.get(
    f"{API}/assets?{params}",
    headers={"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"},
    timeout=60,
)
r.raise_for_status()
result = r.json()
for a in result["data"]:
    print(a["title"], a["mimeType"], a["size"])
meta = result["meta"]
print(f"Page {meta['page']} of {meta['pageCount']}")`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"
VID_ID="REPLACE_WITH_LIBRARY_UUID"

# GET full URL: $API/assets?libraryId=…&page=1&limit=20
curl -sS \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" \\
  "$API/assets?libraryId=$VID_ID&page=1&limit=20" \\
  | jq '.data[] | {title,mimeType,size}'`}
            />

            <MultiCode
              title="Download a file"
              postman={`GET {{base}}/assets/{{asset_id}}/download
Authorization: Bearer {{key}}
(Send and follow redirects — save response to file.)`}
              node={`import fs from "node:fs";

const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const assetId = "REPLACE_WITH_ASSET_ID";

// GET full URL: \`\${BASE}/assets/\${assetId}/download\`
const res = await fetch(\`\${BASE}/assets/\${assetId}/download\`, {
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "*/*",
  },
  redirect: "follow",
});
if (!res.ok) throw new Error(await res.text());
const buffer = Buffer.from(await res.arrayBuffer());
fs.writeFileSync("file.mp4", buffer);`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
asset_id = "REPLACE_WITH_ASSET_ID"

# GET URL: f"{API}/assets/{asset_id}/download"
with requests.get(
    f"{API}/assets/{asset_id}/download",
    headers={"Authorization": f"Bearer {API_KEY}"},
    stream=True,
    timeout=300,
) as r:
    r.raise_for_status()
    with open("file.mp4", "wb") as f:
        for chunk in r.iter_content(chunk_size=65536):
            f.write(chunk)`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"
ASSET_ID="REPLACE_WITH_ASSET_ID"

# GET full URL: $API/assets/$ASSET_ID/download
curl -sS -L \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  "$API/assets/$ASSET_ID/download" -o file.mp4`}
            />

            <MultiCode
              title="Update metadata + move"
              postman={`PATCH {{base}}/assets/{{asset_id}}
Body: { "title": "…", "description": "…" }

POST {{base}}/assets/{{asset_id}}/move
Body: { "targetLibraryId": "…", "targetFolderId": null }`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const auth = (ct?: boolean) => ({
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
  ...(ct ? { "Content-Type": "application/json" } : {}),
});

const assetId = "…";
const imagesLibId = "…";

// PATCH — full URL: \`\${BASE}/assets/\${assetId}\`
let res = await fetch(\`\${BASE}/assets/\${assetId}\`, {
  method: "PATCH",
  headers: auth(true),
  body: JSON.stringify({
    title: "Summer Road Trip 2024",
    description: "Coastal drive from Lisbon to Porto.",
  }),
});
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));

// POST — full URL: \`\${BASE}/assets/\${assetId}/move\`
res = await fetch(\`\${BASE}/assets/\${assetId}/move\`, {
  method: "POST",
  headers: auth(true),
  body: JSON.stringify({
    targetLibraryId: imagesLibId,
    targetFolderId: null,
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

asset_id = "…"
images_lib_id = "…"

# PATCH — URL f"{API}/assets/{asset_id}"
s.patch(
    f"{API}/assets/{asset_id}",
    json={"title": "Summer Road Trip 2024"},
    timeout=60,
).raise_for_status()

# POST — URL f"{API}/assets/{asset_id}/move"
s.post(
    f"{API}/assets/{asset_id}/move",
    json={"targetLibraryId": images_lib_id, "targetFolderId": None},
    timeout=60,
).raise_for_status()`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"
ASSET_ID="…"
IMG_LIB_ID="…"

# PATCH full URL: $API/assets/$ASSET_ID
curl -sS -X PATCH "$API/assets/$ASSET_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"title":"Summer Road Trip 2024"}' | jq .data.title

# POST full URL: $API/assets/$ASSET_ID/move
curl -sS -X POST "$API/assets/$ASSET_ID/move" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"targetLibraryId":"'"$IMG_LIB_ID"'","targetFolderId":null}'`}
            />
          </section>

          <Sep />

          {/* ── Uploads ───────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="uploads">File uploads</DocH2>
            <DocP>
              Send the file in <strong className="text-zinc-900">one multipart POST</strong> to{" "}
              <IC>{BASE}/uploads</IC>. Arciin classifies by MIME, runs workers when needed, and emits Socket.IO events.
            </DocP>
            <Callout variant="tip" title="Scopes &amp; ids">
              API keys need <IC>uploads:create</IC>. Resolve slug→id with <IC>GET {BASE}/libraries</IC> (
              <IC>libraries:read</IC>), then query <IC>targetLibraryId</IC> (cuid). Omit it for auto-routing.
            </Callout>
            <Callout variant="tip" title="Example scripts">
              Full list and auth notes: <Link href="/docs#example-scripts" className="font-medium text-primary underline-offset-4 hover:underline">Example scripts (this manual)</Link>.
              On the server repo: <IC>scripts/examples/</IC> (not a browser URL).
            </Callout>
            <div className="space-y-2">
              <EndpointRow method="POST" path="/uploads"                    desc="Multipart upload — query targetLibraryId, targetFolderId → 201 Created with data.assetId" />
              <EndpointRow method="GET"  path="/uploads"                    desc="List recent upload sessions" />
              <EndpointRow method="GET"  path="/uploads/:id"                desc="Get session status" />
              <EndpointRow method="POST" path="/uploads/:id/cancel"         desc="Abandon and remove temp file" />
            </div>

            <RequestUrlsCheatsheet
              label="Copy full URLs — upload"
              requests={[
                { method: "POST", fullPath: "/uploads?targetLibraryId={libraryCuid}", hint: "multipart field file" },
                { method: "GET", fullPath: "/libraries", hint: "Resolve slug → id" },
              ]}
            />

            <MultiCode
              title="Upload one file (multipart)"
              postman={`POST ${BASE}/uploads?targetLibraryId={{library_cuid}}

Authorization: Bearer Token → arc_… (uploads:create)

Body: form-data → file = (select file)

Optional: targetFolderId={{folder_cuid}}

GET ${BASE}/libraries → match slug "images" → use id as targetLibraryId`}
              node={buildNodeMultipartUploadSnippet({ apiBase: BASE, librarySlug: "images" })}
              python={buildPythonMultipartUploadSnippet({ apiBase: BASE, librarySlug: "images" })}
              curl={buildCurlMultipartUploadSnippet({ apiBase: BASE, librarySlug: "images" })}
            />
          </section>

          <Sep />

          {/* ── Example scripts (repo) ───────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="example-scripts">Example scripts (Python)</DocH2>
            <DocP>
              Runnable automation lives in the Arciin install under{" "}
              <IC>scripts/examples/</IC> on the server — there is no{" "}
              <IC>/scripts/examples/README.md</IC> page in the web UI. Use this section and{" "}
              <Link href="/docs#uploads" className="font-medium text-primary underline-offset-4 hover:underline">
                File uploads
              </Link>{" "}
              for copy-paste API examples.
            </DocP>
            <Callout variant="tip" title="Setup">
              <IC>pip install requests</IC> — Socket.IO examples also need{" "}
              <IC>python-socketio[client]</IC> and <IC>websocket-client</IC>. Edit shared config once in{" "}
              <IC>lib/arciin_client.py</IC> (API base, API key or email/password).
            </Callout>
            <div className="overflow-hidden rounded-xl border border-zinc-200">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <tr>
                    <th className="px-4 py-2.5">Script</th>
                    <th className="px-4 py-2.5">Purpose</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100">
                  {[
                    ["api/01_health_check.py", "Ping API, database, Redis, worker"],
                    ["api/02_list_libraries.py", "List libraries with ids (slug → targetLibraryId)"],
                    ["api/03_list_folders.py", "List folders in a library"],
                    ["api/04_create_folder.py", "Create a folder"],
                    ["api/06_upload_to_library.py", "Multipart upload to a chosen library"],
                    ["api/07_upload_auto_classify.py", "Upload without library — MIME auto-route"],
                    ["api/05_list_assets.py", "List recent assets"],
                    ["api/08_list_app_databases.py", "Logical App data databases"],
                    ["events/01_monitor_api_key.py", "Socket.IO live events (API key)"],
                  ].map(([name, desc]) => (
                    <tr key={name}>
                      <td className="px-4 py-2 font-mono text-xs text-zinc-800">{name}</td>
                      <td className="px-4 py-2 text-zinc-600">{desc}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <DocP className="text-zinc-600">
              Create keys under{" "}
              <Link href="/developer/api-keys" className="font-medium text-primary underline-offset-4 hover:underline">
                Developer → API keys
              </Link>
              . Typical scopes: <IC>uploads:create</IC>, <IC>libraries:read</IC>,{" "}
              <IC>events:subscribe</IC> (Socket.IO). WSL: run <IC>lib/wsl_hosts.sh</IC> in the repo and point{" "}
              <IC>API_BASE</IC> at <IC>http://&lt;WSL-IP&gt;:4000/api</IC>.
            </DocP>
          </section>

          <Sep />

          {/* ── Integrations & connectors ─────────────────────────────────── */}
          <IntegrationsDocs />

          <Sep />

          {/* ── Databases ─────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="databases">App databases</DocH2>
            <DocP>Lightweight JSON stores backed by PostgreSQL. Each database has <strong className="text-zinc-900">tables</strong> (folders) containing <strong className="text-zinc-900">records</strong> (JSON documents). Every new database includes a <IC>Default</IC> table automatically.</DocP>
            <Callout variant="tip" title="Required scopes">
              Scripts need <IC>appdata:databases:read</IC>, <IC>appdata:records:read</IC>, and <IC>appdata:records:write</IC> at minimum.
            </Callout>
            <div className="space-y-1.5">
              {[
                ["GET",    "/app-databases",                              "List all databases → 200"],
                ["POST",   "/app-databases",                              "Create database (auto-creates Default table) → 201 Created"],
                ["DELETE", "/app-databases/:id",                          "Delete database + all tables + records → 200"],
                ["GET",    "/app-databases/:id/tables",                  "List tables → 200"],
                ["POST",   "/app-databases/:id/tables",                  "Create table → 201 Created"],
                ["DELETE", "/app-database-tables/:tableId",             "Delete table + records → 200"],
                ["GET",    "/app-database-tables/:tableId/rows",     "List records → 200"],
                ["POST",   "/app-database-tables/:tableId/rows",     "Create record → 201 Created"],
                ["PATCH",  "/app-database-rows/:rowId",             "Partial update — payload is merged, omitted keys kept → 200"],
                ["PUT",    "/app-database-rows/:rowId",             "Full replace — payload required, becomes the whole payload → 200"],
                ["DELETE", "/app-database-rows/:rowId",             "Delete record → 200"],
              ].map(([m, p, d]) => <EndpointRow key={`${m}-${p}`} method={m} path={p} desc={d} />)}
            </div>

            <DocP className="text-zinc-600">
              Base path for this feature is <IC>{BASE}/app-databases</IC> — same <IC>{BASE}</IC> as everywhere else in this manual.
            </DocP>
            <RequestUrlsCheatsheet
              label="Copy full URLs — app databases"
              requests={[
                { method: "POST", fullPath: "/app-databases", hint: "Create DB" },
                { method: "GET", fullPath: "/app-databases/{dbId}/tables", hint: "List tables" },
                { method: "POST", fullPath: "/app-database-tables/{tableId}/rows", hint: "Create record" },
              ]}
            />

            <MultiCode
              title="Create a database and write records"
              postman={`POST ${BASE}/app-databases
POST ${BASE}/app-databases/{{db_id}}/tables
POST ${BASE}/app-database-tables/{{table_id}}/rows`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const auth = (body?: object) => ({
  headers: {
    Authorization: \`Bearer \${API_KEY}\`,
    Accept: "application/json",
    ...(body
      ? { "Content-Type": "application/json" }
      : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
} as RequestInit);

// 1 · POST — full URL: \`\${BASE}/app-databases\`
let res = await fetch(\`\${BASE}/app-databases\`, {
  method: "POST",
  ...auth({
    name: "ecommerce",
    description: "Orders and products for my storefront",
  }),
});
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const db = json.data;

// 2 · GET — full URL: \`\${BASE}/app-databases/\${db.id}/tables\`
res = await fetch(\`\${BASE}/app-databases/\${db.id}/tables\`, {
  method: "GET",
  ...auth(),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const tables = json.data as { id: string; name: string }[];
console.log("Tables:", tables.map((t) => t.name));

// 3 · POST — full URL: \`\${BASE}/app-databases/\${db.id}/tables\`
res = await fetch(\`\${BASE}/app-databases/\${db.id}/tables\`, {
  method: "POST",
  ...auth({ name: "orders" }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const ordersTable = json.data;

// 4 · POST — full URL: \`\${BASE}/app-database-tables/\${ordersTable.id}/rows\`
res = await fetch(\`\${BASE}/app-database-tables/\${ordersTable.id}/rows\`, {
  method: "POST",
  ...auth({
    name: "order-1042",
    payload: { customerId: "usr_abc", total: 99.98, status: "pending" },
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const record = json.data;
console.log("Created:", record.id);`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

# 1 · POST — URL f"{API}/app-databases"
r = s.post(
    f"{API}/app-databases",
    json={
        "name": "ecommerce",
        "description": "Orders and products",
    },
    timeout=60,
)
r.raise_for_status()
db = r.json()["data"]

# 2 · GET — URL f"{API}/app-databases/{id}/tables"
tables = s.get(f"{API}/app-databases/{db['id']}/tables", timeout=60).json()["data"]

# 3 · POST table — URL f"{API}/app-databases/{id}/tables"
orders_table = s.post(
    f"{API}/app-databases/{db['id']}/tables",
    json={"name": "orders"},
    timeout=60,
).json()["data"]

# 4 · POST record — URL f"{API}/app-database-tables/{id}/rows"
record = s.post(
    f"{API}/app-database-tables/{orders_table['id']}/rows",
    json={
        "name": "order-1042",
        "payload": {"customerId": "usr_abc", "total": 99.98, "status": "pending"},
    },
    timeout=60,
).json()["data"]
print("Created:", record["id"])`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"

# 1 · POST full URL: $API/app-databases
DB_ID=$(curl -sS -X POST "$API/app-databases" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"ecommerce","description":"Orders and products"}' \\
  | jq -r '.data.id')

# 2 · POST full URL: $API/app-databases/$DB_ID/tables
TBL_ID=$(curl -sS -X POST "$API/app-databases/$DB_ID/tables" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"orders"}' | jq -r '.data.id')

# 3 · POST full URL: $API/app-database-tables/$TBL_ID/rows
curl -sS -X POST "$API/app-database-tables/$TBL_ID/rows" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" -H "Accept: application/json" \\
  -d '{"name":"order-1042","payload":{"customerId":"usr_abc","total":99.98,"status":"pending"}}' \\
  | jq .data.id`}
            />

            <MultiCode
              title="Read, update, delete records"
              postman={`GET {{base}}/app-database-tables/{{table_id}}/rows
PATCH {{base}}/app-database-rows/{{row_id}}
DELETE {{base}}/app-database-rows/{{row_id}}`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const h = {
  Authorization: \`Bearer \${API_KEY}\`,
  Accept: "application/json",
};
const tableId = "…";
const recordId = "…";

// GET — full URL: \`\${BASE}/app-database-tables/\${tableId}/rows\`
let res = await fetch(
  \`\${BASE}/app-database-tables/\${tableId}/rows\`,
  { headers: h },
);
let json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));
const { data: records } = json;

// PATCH — full URL: \`\${BASE}/app-database-rows/\${recordId}\`
res = await fetch(\`\${BASE}/app-database-rows/\${recordId}\`, {
  method: "PATCH",
  headers: { ...h, "Content-Type": "application/json" },
  body: JSON.stringify({
    payload: { status: "shipped" },
  }),
});
json = await res.json();
if (!res.ok) throw new Error(JSON.stringify(json));

// DELETE — full URL: \`\${BASE}/app-database-rows/\${recordId}\`
res = await fetch(\`\${BASE}/app-database-rows/\${recordId}\`, {
  method: "DELETE",
  headers: h,
});
if (!res.ok) {
  json = await res.json();
  throw new Error(JSON.stringify(json));
}`}
              python={`import os, requests

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
s = requests.Session()
s.headers.update({"Authorization": f"Bearer {API_KEY}", "Accept": "application/json"})

table_id = "…"
record_id = "…"

# GET — f"{API}/app-database-tables/{table_id}/rows"
records = s.get(f"{API}/app-database-tables/{table_id}/rows", timeout=60).json()["data"]

# PATCH — f"{API}/app-database-rows/{record_id}"
s.patch(
    f"{API}/app-database-rows/{record_id}",
    json={"payload": {"status": "shipped"}},
    timeout=60,
).raise_for_status()

# DELETE — f"{API}/app-database-rows/{record_id}"
s.delete(f"{API}/app-database-rows/{record_id}", timeout=60).raise_for_status()`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"
TBL_ID="…"
REC_ID="…"

# GET full URL: $API/app-database-tables/$TBL_ID/rows
curl -sS "$API/app-database-tables/$TBL_ID/rows" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Accept: application/json" | jq '.data[] | {name,payload}'

# PATCH full URL: $API/app-database-rows/$REC_ID
curl -sS -X PATCH "$API/app-database-rows/$REC_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{"payload":{"status":"shipped"}}'

# DELETE full URL: $API/app-database-rows/$REC_ID
curl -sS -X DELETE "$API/app-database-rows/$REC_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY"`}
            />

            <DocH3>PATCH merges, PUT replaces</DocH3>
            <DocP>
              <IC>PATCH</IC> changes only what you send. Sending <IC>{`{"payload":{"price":13.99}}`}</IC> to a row that also has a
              <IC>category</IC> and an <IC>image</IC> updates the price and keeps both.
            </DocP>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr><th className="px-4 py-2">In the PATCH payload</th><th className="px-4 py-2">Result</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-700">
                  <tr><td className="px-4 py-2">object, where the row has an object</td><td className="px-4 py-2">merged recursively — <IC>{`{"image":{"title":"New"}}`}</IC> keeps <IC>image.assetId</IC></td></tr>
                  <tr><td className="px-4 py-2">array</td><td className="px-4 py-2">replaces the whole array</td></tr>
                  <tr><td className="px-4 py-2">string, number, boolean</td><td className="px-4 py-2">replaces</td></tr>
                  <tr><td className="px-4 py-2"><IC>null</IC></td><td className="px-4 py-2">stored as <IC>null</IC> (not a deletion)</td></tr>
                  <tr><td className="px-4 py-2">key not sent</td><td className="px-4 py-2">left exactly as it was</td></tr>
                </tbody>
              </table>
            </div>
            <DocP className="text-zinc-600">
              To remove a key, or to overwrite the row wholesale, send the complete payload with <IC>PUT</IC>. <IC>name</IC> and
              <IC>mimeType</IC> follow the same rule: omitted means unchanged.
            </DocP>

            <DocH3>Upload a file, then reference it from a row</DocH3>
            <DocP>
              App Data rows are plain JSON, so a file is referenced by storing its <IC>assetId</IC> (and, for convenience, a
              download path) inside the payload. There is no foreign key: deleting the asset does not delete the row, and your
              app decides what a missing asset means. <IC>POST /uploads</IC> answers <strong className="text-zinc-900">201 Created</strong>{" "}
              with <IC>data.assetId</IC>. Scopes: <IC>uploads:create</IC> and <IC>appdata:records:write</IC>.
            </DocP>
            <MultiCode
              title="Menu item with a photo"
              postman={`POST {{base}}/uploads?targetLibraryId={{images_library_id}}   (form-data: file)
→ 201 { "data": { "assetId": "…" } }
POST {{base}}/app-database-tables/{{table_id}}/rows
→ 201`}
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const BASE = "${BASE}";
const auth = { Authorization: \`Bearer \${API_KEY}\` };

// 1 · Upload — 201 Created
const form = new FormData();
form.append("file", new Blob([await fs.promises.readFile("margherita.jpg")]), "margherita.jpg");
let res = await fetch(\`\${BASE}/uploads?targetLibraryId=\${imagesLibraryId}\`, {
  method: "POST", headers: auth, body: form,
});
if (res.status !== 201) throw new Error(JSON.stringify(await res.json()));
const { data: upload } = await res.json();

// 2 · Store the reference in a row — 201 Created
res = await fetch(\`\${BASE}/app-database-tables/\${menuTableId}/rows\`, {
  method: "POST",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({
    name: "margherita",
    payload: {
      price: 12.99,
      category: "pizza",
      image: {
        assetId: upload.assetId,
        title: "Margherita",
        // Needs the same Bearer key to fetch; not a public link.
        downloadUrl: \`/api/assets/\${upload.assetId}/download\`,
      },
    },
  }),
});
if (res.status !== 201) throw new Error(JSON.stringify(await res.json()));

// 3 · Later: change only the price. category and image are kept.
await fetch(\`\${BASE}/app-database-rows/\${(await res.json()).data.id}\`, {
  method: "PATCH",
  headers: { ...auth, "Content-Type": "application/json" },
  body: JSON.stringify({ payload: { price: 13.99 } }),
});`}
              python={`import os, requests

API = "${BASE}"
s = requests.Session()
s.headers["Authorization"] = f"Bearer {os.environ['ARCIIN_KEY']}"

# 1 · Upload — 201 Created
with open("margherita.jpg", "rb") as fh:
    r = s.post(f"{API}/uploads", params={"targetLibraryId": images_library_id},
               files={"file": ("margherita.jpg", fh, "image/jpeg")}, timeout=300)
assert r.status_code == 201, r.text
asset_id = r.json()["data"]["assetId"]

# 2 · Row referencing it — 201 Created
r = s.post(f"{API}/app-database-tables/{menu_table_id}/rows", json={
    "name": "margherita",
    "payload": {"price": 12.99, "category": "pizza",
                "image": {"assetId": asset_id, "title": "Margherita",
                          "downloadUrl": f"/api/assets/{asset_id}/download"}},
}, timeout=60)
assert r.status_code == 201, r.text

# 3 · Change only the price — merge keeps category and image
s.patch(f"{API}/app-database-rows/{r.json()['data']['id']}",
        json={"payload": {"price": 13.99}}, timeout=60).raise_for_status()`}
              curl={`# 1 · Upload — expect HTTP 201
ASSET_ID=$(curl -sS -X POST "$API/uploads?targetLibraryId=$IMAGES_LIBRARY_ID" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@margherita.jpg" | jq -r '.data.assetId')

# 2 · Row referencing it — expect HTTP 201
curl -sS -X POST "$API/app-database-tables/$TBL_ID/rows" \\
  -H "Authorization: Bearer $ARCIIN_KEY" -H "Content-Type: application/json" \\
  -d "{\\"name\\":\\"margherita\\",\\"payload\\":{\\"price\\":12.99,\\"category\\":\\"pizza\\",\\"image\\":{\\"assetId\\":\\"$ASSET_ID\\",\\"downloadUrl\\":\\"/api/assets/$ASSET_ID/download\\"}}}"`}
            />
          </section>

          <Sep />

          {/* ── Responses ─────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="responses">JSON response shapes</DocH2>
            <DocP>Every route returns the same envelope — check HTTP status first, then <IC>error.code</IC>.</DocP>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-semibold text-zinc-700">Success (2xx)</p>
                <CodeBlock title="Success">{`{
  "data": {
    "id": "clx1abc",
    "name": "Videos",
    "assetCount": 142
  }
}`}</CodeBlock>
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold text-zinc-700">Error (4xx / 5xx)</p>
                <CodeBlock title="Error">{`{
  "error": {
    "code": "UNAUTHENTICATED",
    "message": "Invalid or revoked API key.",
    "details": {}
  }
}`}</CodeBlock>
              </div>
            </div>
            <DocH3>Status codes</DocH3>
            <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
              <table className="w-full text-left text-[13px]">
                <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
                  <tr><th className="px-4 py-2">Status</th><th className="px-4 py-2">Meaning</th></tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 text-zinc-700">
                  <tr><td className="px-4 py-2 font-mono">200</td><td className="px-4 py-2">Read, update (<IC>PATCH</IC>/<IC>PUT</IC>) or delete succeeded.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">201</td><td className="px-4 py-2">Created. Returned by every create: <IC>POST /uploads</IC>, <IC>POST /app-databases</IC>, <IC>POST /app-databases/:id/tables</IC>, <IC>POST /app-database-tables/:id/rows</IC>, <IC>POST /libraries/:id/folders</IC>, <IC>POST /api-keys</IC>, <IC>POST /shares</IC>, <IC>POST /webhooks</IC>. Treat any 2xx as success.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">400</td><td className="px-4 py-2"><IC>VALIDATION_ERROR</IC> — the body or query is invalid; <IC>error.details</IC> says which field.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">401</td><td className="px-4 py-2"><IC>UNAUTHENTICATED</IC> — no credential, or the key is unknown, revoked, or expired.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">403</td><td className="px-4 py-2"><IC>FORBIDDEN</IC> — the key is valid but lacks the scope this route needs (or the plan lacks the feature).</td></tr>
                  <tr><td className="px-4 py-2 font-mono">404</td><td className="px-4 py-2"><IC>NOT_FOUND</IC> — no such resource, or not one this key can see.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">409</td><td className="px-4 py-2"><IC>ALREADY_EXISTS</IC> — e.g. a row name already used in that table.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">429</td><td className="px-4 py-2"><IC>RATE_LIMITED</IC> — this key&apos;s per-minute limit is used up. Wait <IC>Retry-After</IC> seconds. Every keyed response carries <IC>X-RateLimit-Limit</IC> and <IC>X-RateLimit-Remaining</IC>; new keys default to 600 requests/minute.</td></tr>
                  <tr><td className="px-4 py-2 font-mono">502</td><td className="px-4 py-2"><IC>UPSTREAM_UNAVAILABLE</IC> — the web address answered but the API behind it did not; retry shortly.</td></tr>
                </tbody>
              </table>
            </div>
            <DocP className="text-zinc-600">Errors always carry this JSON body — never an empty one — so read <IC>error.code</IC> rather than parsing <IC>message</IC>.</DocP>
            <CodeBlock title="Paginated list">{`{
  "data": [ /* array of items */ ],
  "meta": {
    "page": 1,
    "limit": 20,
    "total": 142,
    "pageCount": 8
  }
}`}</CodeBlock>
          </section>

          <Sep />

          {/* ── Realtime ──────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="realtime">Realtime — Socket.IO</DocH2>
            <DocP>The dashboard uses Socket.IO for live updates. Your scripts can subscribe to the same events.</DocP>
            <MultiCode
              title="Install"
              node={`npm install socket.io-client`}
              python={`pip install python-socketio[asyncio] aiohttp`}
              curl={`# curl does not support Socket.IO — use Node.js or Python for realtime.`}
            />
            <MultiCode
              title="Connect + listen to events"
              node={`import { io } from "socket.io-client";

const socket = io("${socketUrl}", {
  withCredentials: true,                         // browser: send session cookie
  // extraHeaders: { Authorization: "Bearer …" } // Node.js: API key
});

socket.on("connect",             ()  => console.log("connected:", socket.id));
socket.on("connect_error",       err => console.error("auth error:", err.message));

socket.on("upload.progress",  ({ uploadId, progress }) =>
  console.log(\`Upload \${uploadId}: \${progress}%\`));

socket.on("upload.completed", ({ uploadId, assetId }) =>
  console.log(\`Done — asset: \${assetId}\`));

socket.on("asset.created",    ({ assetId, libraryId, title }) =>
  console.log(\`New asset in \${libraryId}: \${title}\`));

// Catch all events at once (v4+)
socket.onAny((event, payload) => console.log(\`[\${event}]\`, payload));`}
              python={buildPythonSocketSnippet({ apiBase: BASE, socketUrl })}
              curl={`# curl does not support Socket.IO — use Node.js or Python.

# Full script: scripts/examples/events/01_monitor_api_key.py
# Shared config: scripts/examples/lib/arciin_client.py`}
            />
          </section>

          <Sep />

          {/* ── Webhooks ──────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="webhooks">Webhooks</DocH2>
            <DocP>Webhooks POST events to your server over HTTPS. Configure endpoints under <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/developer/webhooks">Webhooks</Link>. Always verify the signature before trusting the payload.</DocP>
            <CodeBlock title="Payload shape">{`// POST https://your-server.com/hooks/arciin
// Content-Type: application/json
// x-arciin-signature: sha256=<hex>
{
  "id":        "evt_abc123",
  "type":      "upload.completed",
  "uploadId":  "upl_xyz",
  "assetId":   "ast_def",
  "libraryId": "lib_ghi",
  "userId":    "usr_jkl",
  "progress":  100,
  "message":   "Upload complete.",
  "createdAt": "2024-06-01T12:34:56.000Z"
}`}</CodeBlock>
            <MultiCode
              title="Verify signature + handle events"
              node={`import express from "express";
import crypto from "node:crypto";

const app = express();

app.post("/hooks/arciin",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig    = req.headers["x-arciin-signature"];
    const secret = process.env.ARCIIN_WEBHOOK_SECRET;

    const expected = "sha256=" + crypto
      .createHmac("sha256", secret).update(req.body).digest("hex");
    const valid = (() => {
      try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected)) }
      catch { return false }
    })();

    if (!valid) return res.status(401).json({ error: "Bad signature" });

    const event = JSON.parse(req.body.toString());
    switch (event.type) {
      case "upload.completed": processAsset(event.assetId); break;
      case "asset.deleted":    removeRef(event.assetId);    break;
    }
    res.json({ ok: true });
  }
);`}
              python={`import hashlib, hmac, os
from fastapi import FastAPI, Request, HTTPException

app  = FastAPI()
SECRET = os.environ["ARCIIN_WEBHOOK_SECRET"]

@app.post("/hooks/arciin")
async def webhook(request: Request):
    body = await request.body()
    sig  = request.headers.get("x-arciin-signature", "")
    expected = "sha256=" + hmac.new(
        SECRET.encode(), body, hashlib.sha256).hexdigest()

    if not hmac.compare_digest(sig, expected):
        raise HTTPException(401, "Invalid signature")

    event = await request.json()
    print(f"Event: {event['type']}, asset: {event.get('assetId')}")
    return {"ok": True}`}
              curl={`# Webhooks are received by your server, not sent via curl.
# Test with a manual POST to simulate a delivery:
curl -X POST https://your-server.com/hooks/arciin \\
  -H "Content-Type: application/json" \\
  -H "x-arciin-signature: sha256=test" \\
  -d '{"type":"upload.completed","assetId":"ast_test"}'`}
            />
          </section>

          <Sep />

          {/* ── Remote ────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="remote">Remote access</DocH2>
            <DocP>By default Arciin binds to <IC>localhost</IC>. Set <IC>NEXT_PUBLIC_ARCIIN_PUBLIC_URL</IC> to a stable HTTPS origin so cookies, CORS, and WebSocket upgrades resolve correctly.</DocP>
            <CodeBlock title="Cloudflare quick tunnel" lang="sh">{`# Install cloudflared (Debian / Ubuntu)
curl -fsSL https://pkg.cloudflare.com/cloudflare-public-v2.gpg | \\
  sudo tee /usr/share/keyrings/cloudflare-public-v2.gpg >/dev/null
sudo apt-get update && sudo apt-get install -y cloudflared

# Start tunnel — prints an HTTPS URL, paste it into Settings → Domain
cloudflared tunnel --url http://localhost:3000`}</CodeBlock>
            <CodeBlock title="nginx reverse proxy" lang="nginx">{`server {
    listen 443 ssl;
    server_name cloud.example.com;

    ssl_certificate     /etc/letsencrypt/live/cloud.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/cloud.example.com/privkey.pem;

    # Web app (Next.js :3000)
    location / {
        proxy_pass         http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }

    # Fastify API + Socket.IO (:4000)
    location /api/ {
        proxy_pass         http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header   Upgrade $http_upgrade;
        proxy_set_header   Connection "upgrade";
        proxy_set_header   Host $host;
        proxy_set_header   X-Forwarded-Proto $scheme;
    }
}`}</CodeBlock>
            <Callout variant="warning" title="Cookies are host-scoped">Changing hostname or scheme invalidates existing sessions. Update <IC>NEXT_PUBLIC_ARCIIN_PUBLIC_URL</IC> before restarting.</Callout>
          </section>

          <Sep />

          {/* ── Events ────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="events">Event catalogue</DocH2>
            <DocP>These event names are emitted on Socket.IO and selectable for webhook subscriptions. All payloads follow the <IC>RealtimeEvent</IC> shape.</DocP>
            <CodeBlock title="RealtimeEvent type">{`type RealtimeEvent = {
  id:         string;
  type:       string;        // e.g. "upload.completed"
  userId?:    string;
  libraryId?: string;
  uploadId?:  string;
  assetId?:   string;
  jobId?:     string;
  progress?:  number;        // 0–100
  message?:   string;
  data?:      Record<string, unknown>;
  createdAt:  string;        // ISO-8601
}`}</CodeBlock>
            <div className="space-y-3">
              {Object.entries(EVENT_GROUPS).map(([group, { events, desc }]) => (
                <div key={group} className="rounded-xl border border-primary/20 bg-primary/[0.04] p-4">
                  <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[13px] font-semibold text-zinc-900">{group}</p>
                    <p className="text-[11px] text-zinc-500">{desc}</p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {events.map(evt => (
                      <code key={evt} className="rounded-lg border border-primary/15 bg-white px-2.5 py-1 font-mono text-[12px] text-zinc-700">{evt}</code>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>

          {/* ── Footer ────────────────────────────────────────────────────── */}
          <footer className="rounded-2xl border border-zinc-200 bg-primary/[0.04] p-6 text-sm ring-1 ring-primary/10">
            <p className="font-semibold text-zinc-900">Need more?</p>
            <p className="mt-2 leading-relaxed text-zinc-600">This manual tracks the current API surface. New routes follow the same <IC>data</IC> / <IC>error</IC> envelope. Import <IC>@arciin/shared</IC> types in TypeScript workers for <IC>SocketEventType</IC> and <IC>API_KEY_SCOPES</IC>.</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href="/developer/api-keys" className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary hover:bg-primary/15">API keys →</Link>
              <Link href="/developer/webhooks" className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary">Webhooks →</Link>
              <Link href="/events" className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary">Live events →</Link>
              <Link href="/database" className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 hover:border-primary/30 hover:text-primary">Database browser →</Link>
            </div>
          </footer>
          </article>
        </div>
      </div>
    </LangCtx.Provider>
  )
}

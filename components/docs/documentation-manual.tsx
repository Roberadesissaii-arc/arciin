"use client"

import { createContext, useContext, useEffect, useRef, useState } from "react"
import type { ReactNode } from "react"
import Link from "next/link"
import { API_KEY_SCOPES } from "@arciin/shared"
import { cn } from "@/lib/utils"

const apiBase  = process.env.NEXT_PUBLIC_API_BASE_URL  || "/api"
const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL   || "http://localhost:4000"
const publicUrl = process.env.NEXT_PUBLIC_ARCIIN_PUBLIC_URL || "http://localhost:3000"
const BASE = apiBase.startsWith("http") ? apiBase : `${publicUrl}${apiBase}`

const toc = [
  { href: "#overview",  label: "Overview" },
  { href: "#urls",       label: "URLs & environment" },
  { href: "#playground", label: "API explorer" },
  { href: "#rest",       label: "Authentication" },
  { href: "#api-keys",  label: "API keys" },
  { href: "#libraries", label: "Libraries & folders" },
  { href: "#assets",    label: "Assets" },
  { href: "#uploads",   label: "File uploads" },
  { href: "#databases", label: "App databases" },
  { href: "#responses", label: "JSON responses" },
  { href: "#realtime",  label: "Realtime (Socket.IO)" },
  { href: "#webhooks",  label: "Webhooks" },
  { href: "#remote",    label: "Remote access" },
  { href: "#events",    label: "Event catalogue" },
] as const

// ── Language context ───────────────────────────────────────────────────────────

type Lang = "node" | "python" | "curl"
const LangCtx = createContext<{ lang: Lang; set: (l: Lang) => void }>({ lang: "node", set: () => {} })

const LANG_LABELS: Record<Lang, string> = { node: "Node.js", python: "Python", curl: "curl" }

// ── Primitives ─────────────────────────────────────────────────────────────────

function CodeBlock({ title, lang = "js", children }: { title?: string; lang?: string; children: string }) {
  const [copied, setCopied] = useState(false)
  function copy() {
    navigator.clipboard.writeText(children).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
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

/** Shows a code block only when lang matches. Falls back gracefully when no code provided. */
function MultiCode({ node, python, curl, title }: { node?: string; python?: string; curl?: string; title?: string }) {
  const { lang } = useContext(LangCtx)
  const code = lang === "python" ? python : lang === "curl" ? curl : node
  if (!code) {
    const fallback = node ?? python ?? curl
    if (!fallback) return null
    return <CodeBlock title={title} lang="js">{fallback}</CodeBlock>
  }
  const fileType = lang === "python" ? "python" : lang === "curl" ? "sh" : "js"
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
function DocH3({ children }: { children: ReactNode }) {
  return <h3 className="text-[15px] font-semibold text-zinc-900">{children}</h3>
}
function DocP({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-7 text-zinc-700">{children}</p>
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
  return (
    <div className="flex items-start gap-3 rounded-xl border border-zinc-100 bg-white px-3 py-2.5 shadow-sm">
      <span className={`mt-0.5 shrink-0 rounded-md px-2 py-0.5 font-mono text-[11px] font-bold ${color}`}>{method}</span>
      <div className="min-w-0 flex-1">
        <span className="font-mono text-[13px] text-zinc-900">{path}</span>
        <p className="mt-0.5 text-[12px] text-zinc-500">{desc}</p>
      </div>
    </div>
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
            onClick={() => setHdrs(p => [...p, { id: crypto.randomUUID(), key: "", value: "", enabled: true }])}
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

// ── Main export ───────────────────────────────────────────────────────────────

export function DocumentationManual() {
  const [activeId, setActiveId] = useState("overview")
  const [lang, setLang] = useState<Lang>("node")
  const observerRef = useRef<IntersectionObserver | null>(null)

  useEffect(() => {
    const headings = Array.from(document.querySelectorAll<HTMLElement>("h2[id]"))
    observerRef.current?.disconnect()
    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const e of entries) { if (e.isIntersecting) { setActiveId(e.target.id); break } }
      },
      { rootMargin: "-10% 0% -70% 0%", threshold: 0 },
    )
    headings.forEach((el) => observerRef.current!.observe(el))
    return () => observerRef.current?.disconnect()
  }, [])

  return (
    <LangCtx.Provider value={{ lang, set: setLang }}>
      <div className="xl:grid xl:grid-cols-[minmax(0,210px)_minmax(0,1fr)] xl:items-start xl:gap-12">

        {/* ── TOC sidebar ─────────────────────────────────────────────────── */}
        <nav aria-label="On this page" className="mb-10 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto rounded-2xl border border-zinc-200/80 bg-white/80 p-4 text-sm shadow-sm ring-1 ring-black/[0.04] backdrop-blur-sm xl:sticky xl:top-8 xl:mb-0 xl:block">
          <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-400">On this page</p>
          <ul className="space-y-0.5">
            {toc.map(({ href, label }) => {
              const id = href.slice(1)
              const active = activeId === id
              return (
                <li key={href} className={cn("border-l-2 transition-colors", active ? "border-primary" : "border-transparent")}>
                  <a href={href} className={cn("block rounded-r-lg py-1.5 pl-3 pr-2 text-[13px] transition-colors", active ? "font-semibold text-primary" : "text-zinc-500 hover:text-zinc-900")}>
                    {label}
                  </a>
                </li>
              )
            })}
          </ul>
          <p className="mt-5 border-t border-zinc-200 pt-4 text-[11px] leading-relaxed text-zinc-400">
            Values in <span className="font-mono">code blocks</span> use this instance&apos;s env vars.
          </p>
        </nav>

        {/* ── Right column: lang picker + article ─────────────────────────── */}
        <div className="min-w-0 space-y-5">
          <LangPicker />

          {/* ── Article ────────────────────────────────────────────────────── */}
          <article className="space-y-12 border-t border-zinc-200/80 pt-5 xl:border-t-0 xl:pt-0">

            {/* Mobile pill nav */}
            <nav className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/80 p-4 xl:hidden">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-500">Jump to</p>
              <div className="flex flex-wrap gap-2">
                {toc.map(({ href, label }) => (
                  <a key={href} href={href} className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm hover:border-primary/30 hover:text-primary">{label}</a>
                ))}
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

          {/* ── URLs ──────────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="urls">URLs &amp; environment</DocH2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                { label: "Web app",       value: publicUrl, note: "Session cookie is set on this origin." },
                { label: "REST API base", value: BASE,      note: "Prefix for every endpoint in this manual." },
                { label: "Socket.IO server", value: socketUrl, note: "Connect socket.io-client to this origin.", wide: true },
              ].map((r) => (
                <div key={r.label} className={cn("rounded-xl border border-zinc-200 bg-white p-4 shadow-sm", (r as { label: string; value: string; note: string; wide?: boolean }).wide && "sm:col-span-2")}>
                  <p className="text-[11px] font-bold uppercase tracking-wide text-primary">{r.label}</p>
                  <p className="mt-1 break-all font-mono text-[13px] text-zinc-800">{r.value}</p>
                  <p className="mt-1.5 text-[12px] text-zinc-500">{r.note}</p>
                </div>
              ))}
            </div>
            <CodeBlock title=".env" lang="sh">{`NEXT_PUBLIC_API_BASE_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_ARCIIN_PUBLIC_URL=http://localhost:3000
DATABASE_URL=postgresql://user:pass@localhost:5432/arciin
REDIS_URL=redis://localhost:6379
SESSION_SECRET=replace-with-64-char-random-string`}</CodeBlock>
          </section>

          <Sep />

          {/* ── API Playground ────────────────────────────────────────────── */}
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
            <DocP>Two auth mechanisms are supported. <strong className="text-zinc-900">Session cookie</strong> for browser/same-origin use; <strong className="text-zinc-900">API key Bearer token</strong> for automation and scripts.</DocP>

            <DocH3>Reusable helper (start here)</DocH3>
            <MultiCode
              title="Helper — paste once, use everywhere"
              node={`const API_KEY = process.env.ARCIIN_KEY ?? "arc_live_your_key_here";
const API     = "${BASE}";

async function arciin(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "Accept":        "application/json",
      "Authorization": \`Bearer \${API_KEY}\`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const { error } = await res.json();
    throw new Error(\`\${error.code}: \${error.message}\`);
  }
  return res.json(); // { data: … } or { data: …, meta: … }
}

// Test it
const { data } = await arciin("GET", "/auth/me");
console.log(data.user.name);`}
              python={`import requests, os

API_KEY = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API     = "${BASE}"

s = requests.Session()
s.headers.update({
    "Authorization": f"Bearer {API_KEY}",
    "Accept":        "application/json",
})

def arciin(method, path, **kwargs):
    r = s.request(method, API + path, **kwargs)
    r.raise_for_status()
    return r.json()

# Test it
data = arciin("GET", "/auth/me")["data"]
print(data["user"]["name"])`}
              curl={`export ARCIIN_KEY="arc_live_your_key_here"
export API="${BASE}"

# Convenience alias — use in every example below
arc() {
  curl -sS \\
    -H "Authorization: Bearer $ARCIIN_KEY" \\
    -H "Accept: application/json" \\
    -H "Content-Type: application/json" \\
    "$@"
}

# Test it
arc "$API/auth/me" | jq .data.user.name`}
            />

            <DocH3>Login with email + password (browser session)</DocH3>
            <MultiCode
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
              curl={`# Log in and save cookie jar
arc -c cookies.txt -X POST "$API/auth/login" \\
  -d '{"email":"admin@example.com","password":"secret"}'

# Reuse the session cookie
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

            <MultiCode
              title="Create an API key"
              node={`const { data } = await arciin("POST", "/api-keys", {
  name:   "Uploader bot",
  scopes: ["uploads:create", "assets:read"],
});
console.log(data.rawKey);  // "arc_live_abc…" — save this now
console.log(data.prefix);  // shown in UI for identification`}
              python={`result = arciin("POST", "/api-keys", json={
    "name":   "Uploader bot",
    "scopes": ["uploads:create", "assets:read"],
})["data"]
print(result["rawKey"])   # arc_live_abc… — save now
print(result["prefix"])`}
              curl={`arc -X POST "$API/api-keys" -d '{
  "name":   "Uploader bot",
  "scopes": ["uploads:create","assets:read"]
}' | jq '{key:.data.rawKey,prefix:.data.prefix}'`}
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
          <section className="space-y-5">
            <DocH2 id="libraries">Libraries &amp; folders</DocH2>
            <DocP>Libraries are the top-level containers (Videos, Images, Music, Documents, Inbox). Each has a folder tree you can create and navigate.</DocP>
            <div className="space-y-2">
              <EndpointRow method="GET"    path="/libraries"                    desc="List all libraries with asset counts" />
              <EndpointRow method="GET"    path="/libraries/:id"                desc="Get a single library" />
              <EndpointRow method="POST"   path="/libraries"                    desc="Create a library" />
              <EndpointRow method="PATCH"  path="/libraries/:id"                desc="Update name / description / icon" />
              <EndpointRow method="DELETE" path="/libraries/:id"                desc="Delete library and all assets" />
              <EndpointRow method="GET"    path="/libraries/:id/folders"        desc="List folders inside a library" />
              <EndpointRow method="POST"   path="/libraries/:id/folders"        desc="Create a folder" />
              <EndpointRow method="PATCH"  path="/folders/:folderId"            desc="Rename or move a folder" />
              <EndpointRow method="DELETE" path="/folders/:folderId"            desc="Delete a folder" />
            </div>

            <MultiCode
              title="List libraries + create a folder"
              node={`// List all libraries
const { data: libs } = await arciin("GET", "/libraries");
libs.forEach(l => console.log(\`\${l.name} — \${l.assetCount} assets\`));

const videoLib = libs.find(l => l.slug === "videos");

// Create a folder inside the Videos library
const { data: folder } = await arciin(
  "POST", \`/libraries/\${videoLib.id}/folders\`,
  { name: "2024" }
);
console.log(folder.pathCache); // "/2024"`}
              python={`# List all libraries
libs = arciin("GET", "/libraries")["data"]
for l in libs:
    print(f"{l['name']} — {l['assetCount']} assets")

video_lib = next(l for l in libs if l["slug"] == "videos")

# Create a folder
folder = arciin(
    "POST", f"/libraries/{video_lib['id']}/folders",
    json={"name": "2024"}
)["data"]
print(folder["pathCache"])  # /2024`}
              curl={`# List libraries
arc "$API/libraries" | jq '.data[] | {name,assetCount}'

# Get the Videos library id
VID_ID=$(arc "$API/libraries" | jq -r '.data[] | select(.slug=="videos") | .id')

# Create a folder
arc -X POST "$API/libraries/$VID_ID/folders" \\
  -d '{"name":"2024"}' | jq .data.pathCache`}
            />
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

            <MultiCode
              title="List assets (paginated)"
              node={`const { data, meta } = await arciin("GET",
  "/assets?libraryId=" + videoLibId + "&page=1&limit=20");

data.forEach(a => console.log(a.title, a.mimeType, a.size));
console.log(\`Page \${meta.page} of \${meta.pageCount}\`);`}
              python={`result = arciin("GET", f"/assets?libraryId={video_lib_id}&page=1&limit=20")
for a in result["data"]:
    print(a["title"], a["mimeType"], a["size"])
meta = result["meta"]
print(f"Page {meta['page']} of {meta['pageCount']}")`}
              curl={`arc "$API/assets?libraryId=$VID_ID&page=1&limit=20" \\
  | jq '.data[] | {title,mimeType,size}'`}
            />

            <MultiCode
              title="Download a file"
              node={`// Follows redirect to the actual file
const res = await fetch(\`${BASE}/assets/\${assetId}/download\`, {
  headers: { Authorization: \`Bearer \${API_KEY}\` },
  redirect: "follow",
});
const buffer = Buffer.from(await res.arrayBuffer());
fs.writeFileSync("file.mp4", buffer);`}
              python={`import shutil
r = s.get(f"{API}/assets/{asset_id}/download", stream=True)
with open("file.mp4", "wb") as f:
    shutil.copyfileobj(r.raw, f)`}
              curl={`curl -sS -L \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  "$API/assets/$ASSET_ID/download" -o file.mp4`}
            />

            <MultiCode
              title="Update metadata + move"
              node={`// Update
await arciin("PATCH", \`/assets/\${assetId}\`, {
  title: "Summer Road Trip 2024",
  description: "Coastal drive from Lisbon to Porto.",
});

// Move to a different folder
await arciin("POST", \`/assets/\${assetId}/move\`, {
  targetLibraryId: imagesLibId,
  targetFolderId:  null, // root of library
});`}
              python={`# Update
arciin("PATCH", f"/assets/{asset_id}",
    json={"title": "Summer Road Trip 2024"})

# Move
arciin("POST", f"/assets/{asset_id}/move",
    json={"targetLibraryId": images_lib_id, "targetFolderId": None})`}
              curl={`# Update
arc -X PATCH "$API/assets/$ASSET_ID" \\
  -d '{"title":"Summer Road Trip 2024"}' | jq .data.title

# Move
arc -X POST "$API/assets/$ASSET_ID/move" \\
  -d '{"targetLibraryId":"'$IMG_LIB_ID'","targetFolderId":null}'`}
            />
          </section>

          <Sep />

          {/* ── Uploads ───────────────────────────────────────────────────── */}
          <section className="space-y-5">
            <DocH2 id="uploads">File uploads</DocH2>
            <DocP>Three-step flow: <strong className="text-zinc-900">initiate</strong> a session → <strong className="text-zinc-900">send bytes</strong> → <strong className="text-zinc-900">complete</strong> to trigger classification and workers.</DocP>
            <div className="space-y-2">
              <EndpointRow method="POST" path="/uploads"                    desc="Initiate — returns uploadId + uploadUrl" />
              <EndpointRow method="GET"  path="/uploads/:id"                desc="Get session status" />
              <EndpointRow method="POST" path="/uploads/:id/complete"       desc="Finalise — triggers workers" />
              <EndpointRow method="POST" path="/uploads/:id/cancel"         desc="Abandon and remove temp file" />
            </div>

            <MultiCode
              title="Full upload flow"
              node={`import fs from "node:fs";
import path from "node:path";
import FormData from "form-data"; // npm i form-data

const FILE = "./video.mp4";
const filename = path.basename(FILE);
const size = fs.statSync(FILE).size;

// 1 · Initiate
const { data: session } = await arciin("POST", "/uploads", {
  filename, size,
  librarySlug: "videos",  // or: images | music | documents | inbox
  folderId: null,         // optional folder within the library
});
console.log("Session:", session.id, session.status);

// 2 · Send bytes
const form = new FormData();
form.append("file", fs.createReadStream(FILE), filename);
await fetch(session.uploadUrl, {
  method: "PUT",
  body: form,
  headers: { ...form.getHeaders(), Authorization: \`Bearer \${API_KEY}\` },
});

// 3 · Complete
const { data: asset } = await arciin("POST", \`/uploads/\${session.id}/complete\`);
console.log("Asset created:", asset.id, asset.title);`}
              python={`import os, requests, shutil
from pathlib import Path

FILE = Path("video.mp4")
api_key = os.getenv("ARCIIN_KEY", "arc_live_your_key_here")
API = "${BASE}"
hdrs = {"Authorization": f"Bearer {api_key}"}

# 1 · Initiate
session = requests.post(f"{API}/uploads", headers=hdrs, json={
    "filename":    FILE.name,
    "size":        FILE.stat().st_size,
    "librarySlug": "videos",
}).json()["data"]
print("Session:", session["id"])

# 2 · Send bytes
with FILE.open("rb") as fh:
    requests.put(session["uploadUrl"],
        headers=hdrs, files={"file": (FILE.name, fh)})

# 3 · Complete
asset = requests.post(
    f"{API}/uploads/{session['id']}/complete", headers=hdrs
).json()["data"]
print("Asset:", asset["id"], asset["title"])`}
              curl={`FILE="video.mp4"

# 1 · Initiate
SESSION=$(arc -X POST "$API/uploads" -d "{
  \\"filename\\":\\"$FILE\\",
  \\"size\\":$(stat -c%s $FILE),
  \\"librarySlug\\":\\"videos\\"
}")
UPLOAD_ID=$(echo $SESSION | jq -r '.data.id')
UPLOAD_URL=$(echo $SESSION | jq -r '.data.uploadUrl')

# 2 · Send bytes
curl -sS -X PUT "$UPLOAD_URL" \\
  -H "Authorization: Bearer $ARCIIN_KEY" \\
  -F "file=@$FILE"

# 3 · Complete
arc -X POST "$API/uploads/$UPLOAD_ID/complete" | jq .data.id`}
            />
          </section>

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
                ["GET",    "/app-databases",                              "List all databases"],
                ["POST",   "/app-databases",                              "Create database (auto-creates Default table)"],
                ["DELETE", "/app-databases/:id",                          "Delete database + all tables + records"],
                ["GET",    "/app-databases/:id/folders",                  "List tables"],
                ["POST",   "/app-databases/:id/folders",                  "Create table"],
                ["DELETE", "/app-database-folders/:folderId",             "Delete table + records"],
                ["GET",    "/app-database-folders/:folderId/records",     "List records"],
                ["POST",   "/app-database-folders/:folderId/records",     "Create record"],
                ["PATCH",  "/app-database-records/:recordId",             "Update record payload"],
                ["DELETE", "/app-database-records/:recordId",             "Delete record"],
              ].map(([m, p, d]) => <EndpointRow key={`${m}-${p}`} method={m} path={p} desc={d} />)}
            </div>

            <MultiCode
              title="Create a database and write records"
              node={`// 1 · Create database
const { data: db } = await arciin("POST", "/app-databases", {
  name:        "ecommerce",
  description: "Orders and products for my storefront",
});

// 2 · List tables (Default already exists)
const { data: tables } = await arciin("GET", \`/app-databases/\${db.id}/folders\`);
const defaultTable = tables.find(t => t.name === "Default");

// 3 · Create an "orders" table
const { data: ordersTable } = await arciin(
  "POST", \`/app-databases/\${db.id}/folders\`,
  { name: "orders" }
);

// 4 · Insert a record
const { data: record } = await arciin(
  "POST", \`/app-database-folders/\${ordersTable.id}/records\`,
  {
    name:    "order-1042",
    payload: { customerId: "usr_abc", total: 99.98, status: "pending" },
  }
);
console.log("Created:", record.id);`}
              python={`# 1 · Create database
db = arciin("POST", "/app-databases", json={
    "name": "ecommerce",
    "description": "Orders and products",
})["data"]

# 2 · Get the auto-created Default table
tables = arciin("GET", f"/app-databases/{db['id']}/folders")["data"]

# 3 · Create an orders table
orders_table = arciin(
    "POST", f"/app-databases/{db['id']}/folders",
    json={"name": "orders"}
)["data"]

# 4 · Insert a record
record = arciin(
    "POST", f"/app-database-folders/{orders_table['id']}/records",
    json={
        "name":    "order-1042",
        "payload": {"customerId": "usr_abc", "total": 99.98, "status": "pending"},
    }
)["data"]
print("Created:", record["id"])`}
              curl={`# 1 · Create database
DB_ID=$(arc -X POST "$API/app-databases" \\
  -d '{"name":"ecommerce","description":"Orders and products"}' \\
  | jq -r '.data.id')

# 2 · Create orders table
TBL_ID=$(arc -X POST "$API/app-databases/$DB_ID/folders" \\
  -d '{"name":"orders"}' | jq -r '.data.id')

# 3 · Insert record
arc -X POST "$API/app-database-folders/$TBL_ID/records" -d '{
  "name": "order-1042",
  "payload": {"customerId":"usr_abc","total":99.98,"status":"pending"}
}' | jq .data.id`}
            />

            <MultiCode
              title="Read, update, delete records"
              node={`// List all records in a table
const { data: records } = await arciin("GET", \`/app-database-folders/\${tableId}/records\`);

// Update a record
await arciin("PATCH", \`/app-database-records/\${recordId}\`, {
  payload: { ...existingPayload, status: "shipped" },
});

// Delete a record
await arciin("DELETE", \`/app-database-records/\${recordId}\`);`}
              python={`# List records
records = arciin("GET", f"/app-database-folders/{table_id}/records")["data"]

# Update
arciin("PATCH", f"/app-database-records/{record_id}",
    json={"payload": {**existing, "status": "shipped"}})

# Delete
arciin("DELETE", f"/app-database-records/{record_id}")`}
              curl={`# List records
arc "$API/app-database-folders/$TBL_ID/records" | jq '.data[] | {name,payload}'

# Update
arc -X PATCH "$API/app-database-records/$REC_ID" \\
  -d '{"payload":{"status":"shipped"}}'

# Delete
arc -X DELETE "$API/app-database-records/$REC_ID"`}
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
    "code": "UNAUTHORIZED",
    "message": "Authentication required.",
    "details": {}
  }
}`}</CodeBlock>
              </div>
            </div>
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
              python={`import asyncio, socketio

sio = socketio.AsyncClient()

@sio.event
async def connect():
    print("connected:", sio.sid)

@sio.on("upload.completed")
async def on_upload(data):
    print("Done — asset:", data.get("assetId"))

@sio.on("asset.created")
async def on_asset(data):
    print("New asset:", data.get("title"))

async def main():
    await sio.connect("${socketUrl}",
        headers={"Authorization": "Bearer arc_live_your_key_here"})
    await sio.wait()

asyncio.run(main())`}
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

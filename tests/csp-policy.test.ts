import { existsSync, readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

/**
 * The web Content-Security-Policy, and why two relaxations stay.
 *
 * 'unsafe-inline' (script-src): the App Router emits inline bootstrap and RSC
 * streaming scripts, and layout.tsx runs an inline theme guard. Next's only
 * supported way to drop it is per-request nonces, which its own guide says
 * forces every page to dynamic rendering (no static optimisation). Deferred as
 * a deliberate v1.2.0 item, not hacked around.
 *
 * 'wasm-unsafe-eval': pdf.js compiles its JBIG2/OpenJPEG decoders from
 * WebAssembly; without it scanned PDFs render as grey placeholders.
 *
 * What must hold regardless is pinned below.
 */
const ROOT = path.resolve(__dirname, "..")
const config = readFileSync(path.join(ROOT, "apps/web/next.config.ts"), "utf8")
const cspBlock = config.slice(config.indexOf("const csp = ["), config.indexOf('].join("; ")'))

describe("web CSP", () => {
  it("never grants 'unsafe-eval' in production", () => {
    expect(config).toContain(`process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"`)
    expect(cspBlock).not.toMatch(/script-src[^`"]*'unsafe-eval'(?!\$)/)
  })

  it("keeps the hard lines", () => {
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ]) {
      expect(cspBlock).toContain(directive)
    }
  })

  it("wasm-unsafe-eval is only there because pdf.js ships WASM decoders", () => {
    expect(cspBlock).toContain("'wasm-unsafe-eval'")
    expect(existsSync(path.join(ROOT, "apps/web/public/pdfjs-wasm/openjpeg.wasm"))).toBe(true)
  })

  it("no remote script or style origin is allowed", () => {
    expect(cspBlock).not.toMatch(/script-src[^"`]*https?:/)
    expect(cspBlock).not.toMatch(/style-src[^"`]*https?:/)
  })
})

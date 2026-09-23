import { describe, expect, it } from "vitest"

import { buildQuickTunnelArgs } from "../apps/api/src/services/remote-access/cloudflare-tunnel"

/**
 * Every quick tunnel this server created answered 404 — through Cloudflare,
 * with the hostname registered, the connector up and the origin healthy. It
 * reproduced when cloudflared was run by hand, which is what made it look like
 * a Cloudflare outage.
 *
 * It was not. With no --config, cloudflared reads ~/.cloudflared/config.yml.
 * On this host that file belongs to the licensing authority's named tunnel and
 * ends, as ingress rules must, with a catch-all:
 *
 *     - hostname: license.arciin.com
 *       service: http://127.0.0.1:4443
 *     - service: http_status:404
 *
 * A quick tunnel's hostname is random, so it never matched the named hostname
 * and every request fell through to that catch-all. cloudflared was answering
 * 404 itself. Measured on this host: default config 404, isolated config 200.
 */

describe("the quick tunnel does not read another tunnel's config", () => {
  const args = buildQuickTunnelArgs("/tmp/arciin-cloudflared-x/config.yml", "http://127.0.0.1:3002")

  it("passes an explicit config so the default is never loaded", () => {
    expect(args).toContain("--config")
    expect(args[args.indexOf("--config") + 1]).toBe("/tmp/arciin-cloudflared-x/config.yml")
  })

  it("puts --config before the subcommand, where cloudflared expects it", () => {
    // cloudflared treats --config as a global flag; after `tunnel` it is not
    // applied and the default file is read anyway.
    expect(args.indexOf("--config")).toBeLessThan(args.indexOf("tunnel"))
  })

  it("still points the tunnel at the desktop web origin", () => {
    expect(args[args.indexOf("--url") + 1]).toBe("http://127.0.0.1:3002")
  })

  it("never names the shared config the licensing tunnel owns", () => {
    expect(args.join(" ")).not.toContain(".cloudflared/config.yml")
  })

  it("targets the desktop port, not the mobile one", () => {
    // One cloudflared can run, and it must land on the app that can route both
    // surfaces. Pointing it at 3003 would serve only the mobile PWA.
    expect(args.join(" ")).toContain(":3002")
    expect(args.join(" ")).not.toContain(":3003")
  })
})

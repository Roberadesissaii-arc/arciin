import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  buildAdvertisedLocalAccessUrls,
  formatAdvertisedHttpOrigin,
  resolveAdvertisedHttpPort,
  resolveAdvertisedMobileHttpPort,
} from "./advertised-http"
import { selectLanIpv4Addresses, type LanInterfaceAddress } from "./lan-address"

const ROOT = path.resolve(import.meta.dirname, "../../..")

function iface(name: string, address: string): LanInterfaceAddress {
  return { name, address, family: "IPv4", internal: false }
}

describe("resolveAdvertisedHttpPort (CERT-LAN-PORT)", () => {
  it("CASE 1 native explicit public URL keeps :3000", () => {
    expect(
      resolveAdvertisedHttpPort({
        publicUrl: "http://192.168.1.10:3000",
        inContainer: false,
        webPort: "3000",
      }),
    ).toBe("3000")
    expect(
      formatAdvertisedHttpOrigin("192.168.1.10", "3000"),
    ).toBe("http://192.168.1.10:3000")
  })

  it("CASE 2 Docker/Caddy default omits :3000 and uses port 80", () => {
    const port = resolveAdvertisedHttpPort({
      publicUrl: "http://192.168.1.10",
      inContainer: true,
    })
    expect(port).toBe("80")
    expect(formatAdvertisedHttpOrigin("192.168.1.10", port)).toBe("http://192.168.1.10")
  })

  it("CASE 3 Docker custom ARCIIN_HTTP_PORT is advertised", () => {
    const port = resolveAdvertisedHttpPort({
      publicUrl: "http://192.168.1.10",
      httpPort: "18880",
      inContainer: true,
      webPort: "3000",
    })
    expect(port).toBe("18880")
    expect(formatAdvertisedHttpOrigin("192.168.1.10", port)).toBe(
      "http://192.168.1.10:18880",
    )
  })

  it("CASE 4 explicit public URL port wins over ARCIIN_HTTP_PORT", () => {
    expect(
      resolveAdvertisedHttpPort({
        publicUrl: "http://192.168.1.10:9090",
        httpPort: "18880",
        inContainer: true,
      }),
    ).toBe("9090")
  })

  it("CASE 5 remote HTTPS origin does not gain :3000", () => {
    const port = resolveAdvertisedHttpPort({
      publicUrl: "https://arciin.example.test",
      inContainer: true,
    })
    expect(port).toBe("80")
    expect(formatAdvertisedHttpOrigin("arciin.example.test", "443", "https")).toBe(
      "https://arciin.example.test",
    )
    const lan = buildAdvertisedLocalAccessUrls({
      lanHosts: ["192.168.1.10"],
      port,
    })
    expect(lan.lanUrls).toEqual(["http://192.168.1.10"])
    expect(lan.lanUrls.join(" ")).not.toMatch(/:3000/)
  })

  it("CASE 6 development keeps the configured web port", () => {
    expect(
      resolveAdvertisedHttpPort({
        publicUrl: "http://127.0.0.1:3300",
        inContainer: false,
        processPort: "3300",
        webPort: "3300",
      }),
    ).toBe("3300")
    expect(
      resolveAdvertisedHttpPort({
        publicUrl: "http://localhost:3100",
        inContainer: false,
        webPort: "3100",
      }),
    ).toBe("3100")
  })

  it("does not treat the API listen port as a customer-facing web port", () => {
    expect(
      resolveAdvertisedHttpPort({
        publicUrl: "http://192.168.1.10",
        inContainer: false,
        processPort: "4000",
        apiPort: 4000,
        webPort: "",
      }),
    ).toBe("3000")
  })

  it("mobile advertised port follows an explicit mobile URL, else desktop policy", () => {
    expect(
      resolveAdvertisedMobileHttpPort({
        publicUrl: "http://192.168.1.10",
        mobilePublicUrl: "http://192.168.1.10:3400",
        inContainer: true,
        httpPort: "80",
      }),
    ).toBe("3400")
    expect(
      resolveAdvertisedMobileHttpPort({
        publicUrl: "http://192.168.1.10",
        inContainer: true,
        httpPort: "18880",
      }),
    ).toBe("18880")
  })
})

describe("formatAdvertisedHttpOrigin", () => {
  it("omits default http/80 and https/443", () => {
    expect(formatAdvertisedHttpOrigin("192.168.1.50", "80")).toBe("http://192.168.1.50")
    expect(formatAdvertisedHttpOrigin("192.168.1.50", "443", "https")).toBe(
      "https://192.168.1.50",
    )
  })

  it("brackets IPv6 hosts", () => {
    expect(formatAdvertisedHttpOrigin("2001:db8::1", "18880")).toBe(
      "http://[2001:db8::1]:18880",
    )
    expect(formatAdvertisedHttpOrigin("[2001:db8::1]", "80")).toBe("http://[2001:db8::1]")
  })
})

describe("buildAdvertisedLocalAccessUrls", () => {
  it("CASE 7 every LAN URL uses the same advertised port", () => {
    const urls = buildAdvertisedLocalAccessUrls({
      lanHosts: ["10.0.0.8", "192.168.50.2"],
      preferredHost: "192.168.50.2",
      port: "18880",
    })
    expect(urls.lanUrls.every((url) => url.endsWith(":18880"))).toBe(true)
    expect(urls.lanUrls.some((url) => url.includes(":3000"))).toBe(false)
    expect(urls.loopbackUrl).toBe("http://127.0.0.1:18880")
    expect(urls.primaryLanUrl).toBe("http://192.168.50.2:18880")
  })

  it("CASE 8 Docker bridge IPs stay excluded while the port is correct", () => {
    const selection = selectLanIpv4Addresses({
      inContainer: true,
      advertisedLanHost: "192.168.1.10",
      interfaces: [
        iface("eth0", "172.20.0.4"),
        iface("docker0", "172.17.0.1"),
        iface("enp3s0", "192.168.1.10"),
      ],
    })
    expect(selection.selected).not.toContain("172.17.0.1")
    expect(selection.selected).not.toContain("172.20.0.4")
    expect(selection.selected).toEqual(["192.168.1.10"])

    const urls = buildAdvertisedLocalAccessUrls({
      lanHosts: selection.selected,
      preferredHost: "192.168.1.10",
      port: "80",
    })
    expect(urls.lanUrls).toEqual(["http://192.168.1.10"])
    expect(urls.lanUrls.join(" ")).not.toMatch(/172\.17\./)
    expect(urls.lanUrls.join(" ")).not.toMatch(/:3000/)
  })
})

describe("install scripts keep internal vs customer ports distinct", () => {
  it("native install writes the actual web port into ARCIIN_PUBLIC_URL", () => {
    const install = readFileSync(path.join(ROOT, "install.sh"), "utf8")
    expect(install).toMatch(/ARCIIN_PUBLIC_URL" "http:\/\/\$\{lan_ip\}:\$\{web_port\}"/)
    expect(install).not.toMatch(/ARCIIN_PUBLIC_URL" "http:\/\/\$\{lan_ip\}"/)
  })

  it("docker setup advertises Caddy HTTP, not :3000", () => {
    const setup = readFileSync(path.join(ROOT, "scripts/docker-setup.sh"), "utf8")
    expect(setup).toMatch(/lan_public_url="http:\/\/\$\{LAN_IP\}"/)
    expect(setup).toMatch(/lan_public_url="http:\/\/\$\{LAN_IP\}:\$\{http_port\}"/)
    expect(setup).not.toMatch(/ARCIIN_PUBLIC_URL" "http:\/\/\$\{LAN_IP\}:3000"/)
  })
})

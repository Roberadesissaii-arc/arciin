import { describe, expect, it } from "vitest"

import {
  ARCIIN_DEVICE_PROTOCOL_VERSION,
  ARCIIN_DISCOVERY_PATH,
  ARCIIN_MDNS_SERVICE_TYPE,
  buildMdnsAdvertisementRecord,
  discoveryManifestLooksUnsafe,
  formatDevicePairingCode,
  generateDevicePairingCode,
  normalizeDevicePairingCode,
} from "@arciin/config"

import {
  logContainsSecret,
  redactSensitiveObject,
  redactSensitiveUrl,
  serializeRequestForLog,
} from "../apps/api/src/services/security/request-log-redaction"

describe("device pairing protocol constants", () => {
  it("uses protocol version 1 and a well-known path", () => {
    expect(ARCIIN_DEVICE_PROTOCOL_VERSION).toBe(1)
    expect(ARCIIN_DISCOVERY_PATH).toBe("/.well-known/arciin")
    expect(ARCIIN_MDNS_SERVICE_TYPE).toBe("_arciin._tcp")
  })

  it("formats and normalizes a 6-digit PIN", () => {
    expect(formatDevicePairingCode("482731")).toBe("482 731")
    expect(normalizeDevicePairingCode("482 731")).toBe("482731")
    expect(normalizeDevicePairingCode("12")).toBeNull()
  })

  it("generates cryptographically random 6-digit codes", () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateDevicePairingCode()))
    for (const code of codes) {
      expect(code).toMatch(/^\d{6}$/)
    }
    expect(codes.size).toBeGreaterThan(1)
  })

  it("advertises only minimal mDNS TXT data", () => {
    const record = buildMdnsAdvertisementRecord({
      protocolVersion: 1,
      serverId: "11111111-2222-4333-8444-555555555555",
    })
    expect(record.serviceType).toBe("_arciin._tcp")
    expect(record.txt).toEqual({
      protocol: "1",
      path: "/.well-known/arciin",
      sid: "11111111-2222-4333-8444-555555555555",
    })
    expect(JSON.stringify(record)).not.toContain("license")
    expect(JSON.stringify(record)).not.toContain("storage")
  })
})

describe("discovery manifest stays non-sensitive", () => {
  it("rejects a payload that grew storage or user fields", () => {
    expect(
      discoveryManifestLooksUnsafe(
        JSON.stringify({
          service: "arciin",
          protocolVersion: 1,
          serverId: "11111111-2222-4333-8444-555555555555",
          instanceName: "Home",
          version: "1.0.1",
          pairingSupported: true,
          pairingAvailable: true,
          webUrl: "http://192.168.1.20",
        }),
      ),
    ).toBe(false)

    expect(
      discoveryManifestLooksUnsafe(
        JSON.stringify({
          service: "arciin",
          instanceName: "Home",
          storageRoot: "/srv/arciin-storage/arciin",
        }),
      ),
    ).toBe(true)
  })
})

describe("pairing secrets stay out of logs", () => {
  it("redacts pairing codes and device credentials in query strings", () => {
    const code = "482731"
    const credential = "super-secret-device-credential"
    expect(redactSensitiveUrl(`/api/devices/pair?code=${code}`)).not.toContain(code)
    expect(
      redactSensitiveUrl(`/api/devices/session?credential=${credential}`),
    ).not.toContain(credential)
    expect(
      logContainsSecret(
        serializeRequestForLog({
          method: "POST",
          url: `/api/devices/pair?code=${code}`,
          headers: { authorization: `Device ${credential}` },
        }),
        code,
      ),
    ).toBe(false)
    expect(
      logContainsSecret(
        serializeRequestForLog({
          method: "POST",
          url: `/api/devices/session?credential=${credential}`,
          headers: { authorization: `Device ${credential}` },
        }),
        credential,
      ),
    ).toBe(false)
  })

  it("redacts pairing fields on a dumped body", () => {
    const body = redactSensitiveObject({
      code: "482731",
      name: "Office Laptop",
      credential: "raw-device-token",
    })
    expect(body.code).toBe("[redacted]")
    expect(body.credential).toBe("[redacted]")
    expect(body.name).toBe("Office Laptop")
  })
})

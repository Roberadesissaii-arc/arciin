import { generateKeyPairSync } from "node:crypto"

import { describe, expect, it } from "vitest"

import {
  buildHostedTokenPayload,
  buildPublicKeyRegistry,
  licensePublicKeyFromPrivate,
  licenseTokenVersion,
  parseLicensePrivateKey,
  signHostedLicenseToken,
  signHostedLicenseTokenV2,
  verifyHostedLicenseToken,
  LICENSE_PUBLIC_KEYS,
} from "@arciin/config"

/**
 * Entitlement token signing.
 *
 * The v2 format used one HMAC secret for both signing and verification, so the
 * value a customer needed in order to *check* a token was the value they needed
 * in order to *mint* one — anyone self-hosting could grant themselves Business.
 * v3 is Ed25519: the licensing authority holds the private key, installs hold
 * only the public half.
 *
 * These tests pin the properties that makes true — above all that a party
 * holding only public keys cannot produce a token that verifies.
 */

function keypair() {
  const { privateKey } = generateKeyPairSync("ed25519")
  const d = (privateKey.export({ format: "jwk" }) as { d: string }).d
  return { privateRaw: d, key: parseLicensePrivateKey(d), publicRaw: licensePublicKeyFromPrivate(d) }
}

const vendor = keypair()
const KID = "test-kid-1"
const registry = buildPublicKeyRegistry([{ kid: KID, publicKey: vendor.publicRaw }])

function payload(overrides: Partial<ReturnType<typeof buildHostedTokenPayload>> = {}) {
  return {
    ...buildHostedTokenPayload({
      licenseId: "lic_1",
      plan: "pro",
      status: "active",
      instanceId: "instance-1",
      serverLimit: 1,
      keyPrefix: "ARC_PRO…ABCD",
      expiresAt: new Date(Date.now() + 86_400_000),
      graceUntil: new Date(Date.now() + 8 * 86_400_000),
    }),
    ...overrides,
  }
}

describe("v3 signing", () => {
  it("round-trips a token signed by the authority", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    expect(licenseTokenVersion(token)).toBe(3)

    const verified = verifyHostedLicenseToken(token, { publicKeys: registry })
    expect(verified?.plan).toBe("pro")
    expect(verified?.v).toBe(3)
    expect(verified?.alg).toBe("EdDSA")
    expect(verified?.kid).toBe(KID)
  })

  it("binds a token to the instance it was issued for", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    expect(
      verifyHostedLicenseToken(token, { publicKeys: registry, expectedInstanceId: "instance-1" }),
    ).not.toBeNull()
    expect(
      verifyHostedLicenseToken(token, { publicKeys: registry, expectedInstanceId: "instance-2" }),
    ).toBeNull()
  })

  it("rejects a token signed by a different key", () => {
    const attacker = keypair()
    const forged = signHostedLicenseToken(payload({ plan: "business" }), attacker.key, KID)
    expect(verifyHostedLicenseToken(forged, { publicKeys: registry })).toBeNull()
  })

  it("rejects an unknown kid", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, "some-key-we-do-not-ship")
    expect(verifyHostedLicenseToken(token, { publicKeys: registry })).toBeNull()
  })

  it("rejects a tampered body", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    const [prefix, version, body, sig] = token.split(".")

    const decoded = JSON.parse(Buffer.from(body!, "base64url").toString("utf8"))
    decoded.plan = "business"
    decoded.serverLimit = 999
    const tampered = Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")

    expect(
      verifyHostedLicenseToken(`${prefix}.${version}.${tampered}.${sig}`, { publicKeys: registry }),
    ).toBeNull()
  })

  it("rejects a tampered signature", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    const parts = token.split(".")
    const sig = Buffer.from(parts[3]!, "base64url")
    sig[0] ^= 0xff
    parts[3] = sig.toString("base64url")
    expect(verifyHostedLicenseToken(parts.join("."), { publicKeys: registry })).toBeNull()
  })

  it("rejects a token whose version was rewritten to dodge the signature", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    const parts = token.split(".")
    // v3 signs `arclic.v3.<body>`, so relabelling it as v2 breaks the signed
    // input as well as landing in the HMAC branch.
    parts[1] = "v2"
    expect(
      verifyHostedLicenseToken(parts.join("."), {
        publicKeys: registry,
        legacyHmacSecret: "some-legacy-secret-value",
      }),
    ).toBeNull()
  })

  it("rejects a v3 token when no public keys are supplied", () => {
    const token = signHostedLicenseToken(payload(), vendor.key, KID)
    expect(verifyHostedLicenseToken(token, {})).toBeNull()
  })

  it("refuses structurally invalid tokens without throwing", () => {
    for (const bad of ["", "nonsense", "arclic.v3.only-three", "arclic.v9.a.b", "a.b.c.d"]) {
      expect(verifyHostedLicenseToken(bad, { publicKeys: registry })).toBeNull()
    }
  })
})

describe("public keys cannot sign", () => {
  it("a party holding only the public key cannot mint a token that verifies", () => {
    // Everything a self-hosted install has: the published public key material.
    const shipped = LICENSE_PUBLIC_KEYS.map((entry) => entry.publicKey)
    expect(shipped.length).toBeGreaterThan(0)

    // The best they can do is assemble a body and guess a signature.
    const body = Buffer.from(JSON.stringify(payload({ plan: "business" })), "utf8").toString(
      "base64url",
    )
    for (const guess of [
      Buffer.alloc(64).toString("base64url"),
      Buffer.from(shipped[0]!, "base64url").toString("base64url"),
      "not-a-signature",
    ]) {
      expect(
        verifyHostedLicenseToken(`arclic.v3.${body}.${guess}`, { publicKeys: registry }),
      ).toBeNull()
    }
  })

  it("the shipped registry parses, so a released build can verify real tokens", () => {
    const shippedRegistry = buildPublicKeyRegistry()
    expect(shippedRegistry.size).toBe(LICENSE_PUBLIC_KEYS.length)
  })
})

describe("v2 transition", () => {
  const LEGACY = "legacy-hmac-secret-for-transition-only"

  it("accepts a stored v2 token while the legacy secret is configured", () => {
    const token = signHostedLicenseTokenV2(payload(), LEGACY)
    expect(licenseTokenVersion(token)).toBe(2)

    const verified = verifyHostedLicenseToken(token, {
      publicKeys: registry,
      legacyHmacSecret: LEGACY,
    })
    expect(verified?.plan).toBe("pro")
    expect(verified?.v).toBe(2)
  })

  it("rejects v2 once the legacy secret is gone — the default for new installs", () => {
    const token = signHostedLicenseTokenV2(payload(), LEGACY)
    expect(verifyHostedLicenseToken(token, { publicKeys: registry })).toBeNull()
    expect(
      verifyHostedLicenseToken(token, { publicKeys: registry, legacyHmacSecret: null }),
    ).toBeNull()
  })

  it("rejects a v2 token signed with the wrong secret", () => {
    const token = signHostedLicenseTokenV2(payload(), "some-other-secret-entirely")
    expect(
      verifyHostedLicenseToken(token, { publicKeys: registry, legacyHmacSecret: LEGACY }),
    ).toBeNull()
  })

  it("a v2 token cannot be relabelled as v3 to bypass the HMAC check", () => {
    const token = signHostedLicenseTokenV2(payload(), LEGACY)
    const parts = token.split(".")
    parts[1] = "v3"
    expect(
      verifyHostedLicenseToken(parts.join("."), {
        publicKeys: registry,
        legacyHmacSecret: LEGACY,
      }),
    ).toBeNull()
  })
})

describe("key rotation", () => {
  it("verifies tokens from an old and a new key at the same time", () => {
    const oldKey = keypair()
    const newKey = keypair()
    const rotating = buildPublicKeyRegistry([
      { kid: "key-a", publicKey: oldKey.publicRaw, retiredAt: "2026-01-01T00:00:00.000Z" },
      { kid: "key-b", publicKey: newKey.publicRaw },
    ])

    const oldToken = signHostedLicenseToken(payload(), oldKey.key, "key-a")
    const newToken = signHostedLicenseToken(payload(), newKey.key, "key-b")

    expect(verifyHostedLicenseToken(oldToken, { publicKeys: rotating })).not.toBeNull()
    expect(verifyHostedLicenseToken(newToken, { publicKeys: rotating })).not.toBeNull()
  })

  it("stops accepting a key once it is dropped from the registry", () => {
    const retired = keypair()
    const current = keypair()
    const token = signHostedLicenseToken(payload(), retired.key, "key-a")

    const afterRemoval = buildPublicKeyRegistry([{ kid: "key-b", publicKey: current.publicRaw }])
    expect(verifyHostedLicenseToken(token, { publicKeys: afterRemoval })).toBeNull()
  })
})

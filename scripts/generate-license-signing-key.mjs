#!/usr/bin/env node
/**
 * Mint an Ed25519 keypair for signing hosted entitlement tokens.
 *
 * The public half is published in `packages/config/src/license-signing.ts` and
 * ships to every self-hosted install. The private half goes into the license
 * server's environment (`LICENSE_SIGNING_KEY`) and must never be committed,
 * bundled, or handed to a customer.
 *
 *   node scripts/generate-license-signing-key.mjs [kid]
 *
 * Rotation: generate a new key, add its public half to the registry alongside
 * the old one, point the license server at the new private key, and remove the
 * old entry only once every token it signed has expired.
 */

import { generateKeyPairSync } from "node:crypto"

const kid = process.argv[2] ?? `arciin-lic-${new Date().toISOString().slice(0, 7)}`

const { publicKey, privateKey } = generateKeyPairSync("ed25519")
const pub = publicKey.export({ format: "jwk" })
const priv = privateKey.export({ format: "jwk" })

console.log(`
Key id: ${kid}

  1. Publish the PUBLIC key — packages/config/src/license-signing.ts

     {
       kid: ${JSON.stringify(kid)},
       publicKey: ${JSON.stringify(pub.x)},
     },

  2. Keep the PRIVATE key in the license server environment only.
     Never commit it. Never ship it. Never log it.

     LICENSE_SIGNING_KID=${kid}
     LICENSE_SIGNING_KEY=${priv.d}
`)

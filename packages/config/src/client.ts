/**
 * Browser-safe configuration.
 *
 * Everything here is product logic that both the server and the web app need:
 * plan entitlements, preference parsing, permission tables, policy parsing.
 * Nothing here reads the environment, touches the filesystem, or carries
 * signing material.
 *
 * The web app (and @arciin/shared, which the web app imports everywhere) must
 * use this entry, not the package root. The root adds the server env schema,
 * namespace isolation, dotenv loading, and licence signing, which a browser has
 * no use for and which describe how the server is deployed. See
 * tests/config-client-boundary.test.ts.
 */
export * from "./job-options"
export * from "./constants"
export * from "./entitlements"
export * from "./entitlement-state"
export * from "./entitlement-runtime"
export * from "./license"
export * from "./permissions"
export * from "./ai-settings"
export * from "./ai-security"
export * from "./user-preferences"
export * from "./access-control"
export * from "./api-protection"
export * from "./mobile-pairing"
export * from "./integration-code-guide"
export * from "./password-vault-settings"
export * from "./password-vault-ai"
export * from "./lan-origin"
export * from "./lan-address"
export * from "./advertised-http"
// The documented default install path. Shown on the setup form as a
// suggestion; it is public in the README and says nothing about this server.
export * from "./storage-paths"

import { fetchApi } from "@/lib/api/client"
import type {
  AiSecuritySettings,
  AiSettings,
  ApiKeySummary,
  CreateApiKeyInput,
  CreateApiKeyResult,
  GeneralSettings,
  IntegrationSummary,
  JobSummary,
  CloudflareTunnelStatus,
  RemoteAccessSettings,
  SecuritySettings,
  StorageDiscovery,
  StorageMigrateStartResult,
  StorageMigrateStatus,
  StorageSettings,
  StorageVolumeOption,
  DeviceSettingsSnapshot,
  DevicePairingCodeResult,
  PairedDevicePublic,
} from "@/lib/types/models"

export function getGeneralSettings(signal?: AbortSignal) {
  return fetchApi<GeneralSettings>("/settings/general", { method: "GET", signal })
}

export function updateGeneralSettings(instanceName: string) {
  return fetchApi<GeneralSettings>("/settings/general", { method: "PATCH", body: { instanceName } })
}

export function getStorageSettings(signal?: AbortSignal) {
  return fetchApi<StorageSettings>("/settings/storage", {
    method: "GET",
    signal,
  })
}

export function updateStorageSettings(storageRoot: string) {
  return fetchApi<StorageSettings>("/settings/storage", {
    method: "PATCH",
    body: {
      storageRoot,
    },
  })
}

export type StorageVolumesResponse = StorageDiscovery & {
  currentStorageRoot: string
  currentEffectiveRoot: string
  migrationTargets: StorageVolumeOption[]
}

export function getStorageVolumes(signal?: AbortSignal) {
  return fetchApi<StorageVolumesResponse>("/settings/storage/volumes", {
    method: "GET",
    signal,
  })
}

export function getStorageMigrateStatus(signal?: AbortSignal) {
  return fetchApi<StorageMigrateStatus>("/settings/storage/migrate/status", {
    method: "GET",
    signal,
  })
}

export function startStorageMigration(targetPath: string) {
  return fetchApi<StorageMigrateStartResult>("/settings/storage/migrate", {
    method: "POST",
    body: { targetPath },
  })
}

export type MountStorageDeviceInput = {
  deviceId: string
  luksPassphrase?: string
  sudoPassword?: string
  formatAsExt4?: boolean
  confirmErase?: boolean
}

export type MountStorageDeviceResult = {
  device: string
  mountPoint: string
  arciinPath: string
  mapperName?: string
}

export function mountStorageDevice(input: MountStorageDeviceInput) {
  return fetchApi<MountStorageDeviceResult>("/settings/storage/mount", {
    method: "POST",
    body: input,
  })
}

export function getRemoteAccessSettings(signal?: AbortSignal) {
  return fetchApi<RemoteAccessSettings>("/settings/remote-access", {
    method: "GET",
    signal,
  })
}

export function updateRemoteAccessSettings(input: Partial<RemoteAccessSettings>) {
  return fetchApi<RemoteAccessSettings>("/settings/remote-access", {
    method: "PATCH",
    body: input,
  })
}

export function getCloudflareTunnelStatus(signal?: AbortSignal) {
  return fetchApi<CloudflareTunnelStatus>("/settings/cloudflare-tunnel", {
    method: "GET",
    signal,
  })
}

export function startCloudflareTunnel() {
  return fetchApi<CloudflareTunnelStatus>("/settings/cloudflare-tunnel/start", {
    method: "POST",
    body: {},
  })
}

export function stopCloudflareTunnel() {
  return fetchApi<CloudflareTunnelStatus>("/settings/cloudflare-tunnel/stop", {
    method: "POST",
    body: {},
  })
}

export function getJobs(signal?: AbortSignal) {
  return fetchApi<JobSummary[]>("/jobs", {
    method: "GET",
    signal,
  })
}

export function clearJobs() {
  return fetchApi<{ cleared: number }>("/jobs", { method: "DELETE" })
}

export function getApiKeys(signal?: AbortSignal) {
  return fetchApi<ApiKeySummary[]>("/api-keys", {
    method: "GET",
    signal,
  })
}

export function createApiKey(input: CreateApiKeyInput) {
  return fetchApi<CreateApiKeyResult>("/api-keys", {
    method: "POST",
    body: input,
  })
}

export function revokeApiKey(id: string) {
  return fetchApi<{ success: true }>(`/api-keys/${id}`, {
    method: "DELETE",
  })
}

export function rotateApiKey(id: string) {
  return fetchApi<CreateApiKeyResult>(`/api-keys/${id}/rotate`, {
    method: "POST",
    body: {},
  })
}

export function getSecuritySettings(signal?: AbortSignal) {
  return fetchApi<SecuritySettings>("/settings/security", { method: "GET", signal })
}

export function updateSecuritySettings(input: Partial<SecuritySettings>) {
  return fetchApi<SecuritySettings>("/settings/security", { method: "PATCH", body: input })
}

export type ApiProtectionStatus = {
  activeApiKeys: number
  requestsThisMinute: number | null
  globalLimitPerMinute: number
  globalLimitEnabled: boolean
  perKeyLimitPerMinute: number
  perKeyLimitEnabled: boolean
  allowlistCount: number
  blocklistCount: number
  enforceIpAllowlist: boolean
  requireApiKeyExpiry: boolean
  maxApiKeyExpiryDays: number
}

export function getApiProtectionStatus(signal?: AbortSignal) {
  return fetchApi<ApiProtectionStatus>("/settings/api-protection/status", { method: "GET", signal })
}

export type AccessControlStatus = {
  instanceInitialized: boolean
  setupLocked: boolean
  userCount: number
  activeSessions: number
  ownerCount: number
  publicSignupEnabled: boolean
  sessionTimeoutMinutes: number
  loginAlertsEnabled: boolean
  maxFailedLogins: number
  passwordHashing: string
  sessionStorage: string
  cookieFlags: string
}

export function getAccessControlStatus(signal?: AbortSignal) {
  return fetchApi<AccessControlStatus>("/settings/access-control/status", { method: "GET", signal })
}

export function revokeAllSessionsExceptCurrent() {
  return fetchApi<{ revoked: number }>("/settings/access-control/revoke-all-sessions", {
    method: "POST",
    body: {},
  })
}

export function patchApiProtectionIpRule(body: {
  action: "block" | "allow" | "unblock" | "disallow"
  ip: string
}) {
  return fetchApi<{ ipBlocklist: string[]; ipAllowlist: string[] }>(
    "/settings/api-protection/ip-rules",
    { method: "POST", body },
  )
}

export function getAiSettings(signal?: AbortSignal) {
  return fetchApi<AiSettings>("/settings/ai", { method: "GET", signal })
}

export function updateAiSettings(input: Partial<AiSettings>) {
  return fetchApi<AiSettings>("/settings/ai", { method: "PATCH", body: input })
}

export function getAiSecuritySettings(signal?: AbortSignal) {
  return fetchApi<AiSecuritySettings>("/settings/ai-security", { method: "GET", signal })
}

export function updateAiSecuritySettings(input: Partial<AiSecuritySettings>) {
  return fetchApi<AiSecuritySettings>("/settings/ai-security", { method: "PATCH", body: input })
}

export type ClearInstanceDataInput = {
  password: string
  clearChat: boolean
  clearMedia: boolean
  clearAppData?: boolean
}

export function clearInstanceData(input: ClearInstanceDataInput) {
  return fetchApi<{ ok: true }>("/settings/clear-data", {
    method: "POST",
    body: {
      password: input.password,
      clearChat: input.clearChat,
      clearMedia: input.clearMedia,
      clearAppData: input.clearAppData ?? false,
    },
  })
}

export function getIntegrations(signal?: AbortSignal) {
  return fetchApi<IntegrationSummary[]>("/integrations", {
    method: "GET",
    signal,
  })
}

// ---------------------------------------------------------------------------
// Email delivery
// ---------------------------------------------------------------------------

export type EmailSettings = {
  configured: boolean
  host: string | null
  port: number | null
  secure: boolean | null
  username: string | null
  /** The password itself is never returned — only whether one is stored. */
  hasPassword: boolean
  fromAddress: string | null
  fromName: string | null
  notifyAddress: string | null
  notifyOnUrlChange: boolean
  /** Where mail actually goes today, including the owner-account fallback. */
  effectiveNotifyAddress?: string | null
}

export type EmailSettingsInput = {
  host: string
  port: number
  secure?: boolean
  username?: string | null
  /** Omit to keep the stored password; null clears it. */
  password?: string | null
  fromAddress: string
  fromName?: string | null
  notifyAddress?: string | null
  notifyOnUrlChange?: boolean
}

export function getEmailSettings(signal?: AbortSignal) {
  return fetchApi<EmailSettings>("/settings/email", { method: "GET", signal })
}

export function updateEmailSettings(input: EmailSettingsInput) {
  return fetchApi<EmailSettings>("/settings/email", { method: "PUT", body: input })
}

export function clearEmailSettings() {
  return fetchApi<EmailSettings>("/settings/email", { method: "DELETE" })
}

export function sendEmailTest() {
  return fetchApi<{ sent: boolean; to: string }>("/settings/email/test", { method: "POST" })
}

export function emailCurrentPublicUrl() {
  return fetchApi<{ sent: boolean }>("/settings/email/send-current-url", { method: "POST" })
}

// ---------------------------------------------------------------------------
// Discord delivery
// ---------------------------------------------------------------------------

export type DiscordSettings = {
  configured: boolean
  enabled: boolean
  notifyOnUrlChange: boolean
}

export type DiscordSettingsInput = {
  /** Omit to keep the stored webhook; null clears it. */
  webhookUrl?: string | null
  enabled?: boolean
  notifyOnUrlChange?: boolean
}

export function getDiscordSettings(signal?: AbortSignal) {
  return fetchApi<DiscordSettings>("/settings/discord", { method: "GET", signal })
}

export function updateDiscordSettings(input: DiscordSettingsInput) {
  return fetchApi<DiscordSettings>("/settings/discord", { method: "PUT", body: input })
}

export function clearDiscordSettings() {
  return fetchApi<DiscordSettings>("/settings/discord", { method: "DELETE" })
}

export function sendDiscordTest() {
  return fetchApi<{ sent: boolean }>("/settings/discord/test", { method: "POST" })
}

export function getConnectedDevices(signal?: AbortSignal) {
  return fetchApi<DeviceSettingsSnapshot>("/settings/devices", { method: "GET", signal })
}

export function generateDevicePairingCode() {
  return fetchApi<DevicePairingCodeResult>("/settings/devices/pairing", { method: "POST" })
}

export function cancelDevicePairing() {
  return fetchApi<{ cancelled: true }>("/settings/devices/pairing", { method: "DELETE" })
}

export function revokeConnectedDevice(deviceId: string) {
  return fetchApi<{ revoked: true; device: PairedDevicePublic }>(
    `/settings/devices/${deviceId}/revoke`,
    { method: "POST" },
  )
}

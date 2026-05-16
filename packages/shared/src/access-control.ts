export type AccessControlSettings = {
  publicSignupEnabled: boolean
  sessionTimeoutMinutes: number
  loginAlertsEnabled: boolean
  maxFailedLogins: number
  /** Sign out automatically after inactivity (browser tab). */
  idleLogoutEnabled: boolean
  idleLogoutMinutes: number
}

export const DEFAULT_ACCESS_CONTROL: AccessControlSettings = {
  publicSignupEnabled: false,
  sessionTimeoutMinutes: 1440,
  loginAlertsEnabled: false,
  maxFailedLogins: 10,
  idleLogoutEnabled: true,
  idleLogoutMinutes: 30,
}

export function parseAccessControlConfig(sec: unknown): AccessControlSettings {
  const s = sec && typeof sec === "object" ? (sec as Record<string, unknown>) : {}
  return {
    publicSignupEnabled: Boolean(s.publicSignupEnabled ?? DEFAULT_ACCESS_CONTROL.publicSignupEnabled),
    sessionTimeoutMinutes: Number(s.sessionTimeoutMinutes ?? DEFAULT_ACCESS_CONTROL.sessionTimeoutMinutes),
    loginAlertsEnabled: Boolean(s.loginAlertsEnabled ?? DEFAULT_ACCESS_CONTROL.loginAlertsEnabled),
    maxFailedLogins: Number(s.maxFailedLogins ?? DEFAULT_ACCESS_CONTROL.maxFailedLogins),
    idleLogoutEnabled: s.idleLogoutEnabled !== false,
    idleLogoutMinutes: Math.min(
      480,
      Math.max(5, Number(s.idleLogoutMinutes ?? DEFAULT_ACCESS_CONTROL.idleLogoutMinutes)),
    ),
  }
}

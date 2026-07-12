const EMAIL_KEY = "arciin_login_email"
const REMEMBER_KEY = "arciin_remember_me"
const WELCOME_TOAST_KEY = "arciin_pending_welcome_toast"

export function readLoginRemember(): { email: string; rememberMe: boolean } {
  if (typeof window === "undefined") {
    return { email: "", rememberMe: false }
  }
  const rememberMe = localStorage.getItem(REMEMBER_KEY) === "1"
  const email = rememberMe ? (localStorage.getItem(EMAIL_KEY) ?? "").trim() : ""
  return { email, rememberMe }
}

/** Persist email on this device when the user opts in — never stores a password. */
export function writeLoginRemember(email: string, rememberMe: boolean) {
  if (typeof window === "undefined") return
  if (rememberMe) {
    localStorage.setItem(REMEMBER_KEY, "1")
    localStorage.setItem(EMAIL_KEY, email.trim().toLowerCase())
    return
  }
  localStorage.removeItem(REMEMBER_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

export function isRememberMeActive(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(REMEMBER_KEY) === "1"
}

export function clearLoginRemember() {
  if (typeof window === "undefined") return
  localStorage.removeItem(REMEMBER_KEY)
  localStorage.removeItem(EMAIL_KEY)
}

/** Show the welcome toast once after the user lands on the dashboard post-login. */
export function queueWelcomeToast() {
  if (typeof window === "undefined") return
  sessionStorage.setItem(WELCOME_TOAST_KEY, "1")
}

export function consumeWelcomeToast(): boolean {
  if (typeof window === "undefined") return false
  if (sessionStorage.getItem(WELCOME_TOAST_KEY) !== "1") return false
  sessionStorage.removeItem(WELCOME_TOAST_KEY)
  return true
}

export function clearPendingWelcomeToast() {
  if (typeof window === "undefined") return
  sessionStorage.removeItem(WELCOME_TOAST_KEY)
}

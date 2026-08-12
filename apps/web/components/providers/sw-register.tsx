"use client"

import { useEffect } from "react"

export function SwRegister() {
  useEffect(() => {
    if (typeof window === "undefined" || !("serviceWorker" in navigator)) return

    // Service workers only register in a secure context (HTTPS, or localhost/127.0.0.1).
    // Over plain HTTP on a LAN IP the browser blocks it, which also means the browser
    // won't offer to install the app. Skip cleanly and leave a hint instead of surfacing
    // a rejected promise as an error.
    if (!window.isSecureContext) {
      console.info(
        "[arciin] Installable app / offline caching needs HTTPS (or localhost). Add a domain or tunnel for full desktop-app support over the network.",
      )
      return
    }

    navigator.serviceWorker
      .register("/sw.js")
      .then((registration) => {
        // Check for a new worker on every load. Without this a user who already
        // has the worker installed keeps the old one — and therefore the old
        // caching policy — until the browser decides to look, which can be a
        // day. A deploy that cannot reach the client is not a deploy.
        void registration.update()
      })
      .catch(() => {})
  }, [])

  return null
}

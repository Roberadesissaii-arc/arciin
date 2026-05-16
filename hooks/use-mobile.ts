import * as React from "react"

/** Matches Tailwind `md` — below this is phone (web app gated). */
export const MOBILE_BREAKPOINT = 768
/** Matches Tailwind `lg` — tablet is md through lg−1. */
export const DESKTOP_BREAKPOINT = 1024

const TABLET_MEDIA = `(min-width: ${MOBILE_BREAKPOINT}px) and (max-width: ${DESKTOP_BREAKPOINT - 1}px)`

export function useIsTablet() {
  const [isTablet, setIsTablet] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined"
      ? undefined
      : window.matchMedia(TABLET_MEDIA).matches,
  )

  React.useEffect(() => {
    const mql = window.matchMedia(TABLET_MEDIA)
    const onChange = () => setIsTablet(mql.matches)
    onChange()
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isTablet
}

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(() =>
    typeof window === "undefined" ? undefined : window.innerWidth < MOBILE_BREAKPOINT
  )

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return !!isMobile
}

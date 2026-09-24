import { readFileSync } from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

import {
  DEFAULT_USER_PREFERENCES,
  mergeUserPreferences,
  parseUserPreferences,
} from "../packages/config/src/user-preferences"

/**
 * Sidebar expand/collapse is a saved preference, and only a person's own
 * toggle may change it.
 *
 * It was inconsistent across reloads for three separate reasons: a
 * tablet-width window auto-collapsed through the same setter that wrote the
 * cookie, opening the file viewer did the same, and the cookie expired after
 * a week. The first two are the ones worth guarding.
 */

const read = (rel: string) => readFileSync(path.resolve(__dirname, "..", rel), "utf8")

describe("appearance.sidebarCollapsed", () => {
  it("defaults to expanded", () => {
    expect(DEFAULT_USER_PREFERENCES.appearance.sidebarCollapsed).toBe(false)
    expect(parseUserPreferences({}).appearance.sidebarCollapsed).toBe(false)
  })

  it("round-trips, and ignores junk", () => {
    expect(parseUserPreferences({ appearance: { sidebarCollapsed: true } }).appearance.sidebarCollapsed).toBe(true)
    expect(parseUserPreferences({ appearance: { sidebarCollapsed: "yes" } }).appearance.sidebarCollapsed).toBe(false)
  })

  it("a patch to it leaves every other appearance setting alone", () => {
    const current = parseUserPreferences({ appearance: { accentColor: "#3b82f6", compactView: true } })
    const next = mergeUserPreferences(current, { appearance: { sidebarCollapsed: true } })
    expect(next.appearance.sidebarCollapsed).toBe(true)
    expect(next.appearance.accentColor).toBe("#3b82f6")
    expect(next.appearance.compactView).toBe(true)
  })
})

describe("only a person's toggle is remembered", () => {
  const sidebar = read("apps/web/components/ui/sidebar.tsx")

  it("viewport-driven changes go through the non-persisting path", () => {
    const sync = sidebar.slice(
      sidebar.indexOf("const syncSidebarOpenForViewport"),
      sidebar.indexOf("// The saved preference arrives"),
    )
    expect(sync).toContain("applyOpenRef.current(false)")
    expect(sync).not.toContain("setOpenRef")
    expect(sync).not.toContain("document.cookie")
  })

  it("applyOpen itself never writes the cookie or the preference", () => {
    const apply = sidebar.slice(
      sidebar.indexOf("const applyOpen = React.useCallback"),
      sidebar.indexOf("const preferredRef"),
    )
    expect(apply).not.toContain("document.cookie")
    expect(apply).not.toContain("onPreferred")
  })

  it("opening the file viewer collapses transiently", () => {
    const viewer = read("apps/web/components/libraries/asset-viewer-context.tsx")
    expect(viewer).toContain("sidebar.setOpenTransient(false)")
    expect(viewer).not.toMatch(/sidebar\.setOpen\(false\)/)
  })

  it("the dashboard shell persists through saved preferences", () => {
    const shell = read("apps/web/components/app-shell/dashboard-shell.tsx")
    expect(shell).toContain("PersistedSidebarProvider")
    const provider = read("apps/web/components/app-shell/persisted-sidebar-provider.tsx")
    expect(provider).toContain("sidebarCollapsed")
    expect(provider).toContain("updateUserPreferences")
    expect(provider).not.toContain("localStorage")
  })
})

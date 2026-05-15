"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef } from "react"
import { usePathname } from "next/navigation"
import { Command, Search, Upload } from "lucide-react"

import { CommandPalettePanel } from "@/components/app-shell/command-palette-panel"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useUiStore } from "@/lib/stores/ui-store"
import { useSocketStore } from "@/lib/stores/socket-store"

export function DashboardHeader() {
  const pathname = usePathname()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commandOpen = useUiStore((state) => state.commandOpen)
  const setCommandOpen = useUiStore((state) => state.setCommandOpen)
  const connected = useSocketStore((state) => state.connected)

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault()
        setCommandOpen(!useUiStore.getState().commandOpen)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [setCommandOpen])

  const crumbs = useMemo(() => {
    const segments = pathname.split("/").filter(Boolean)
    return segments.map((segment, index) => {
      const label =
        segment === "dashboard"
          ? "Home"
          : segment.replace(/-/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
      return {
        href: `/${segments.slice(0, index + 1).join("/")}`,
        label,
      }
    })
  }, [pathname])

  const parentCrumb = crumbs.length > 1 ? crumbs[crumbs.length - 2] : null
  const leafCrumb = crumbs.length > 0 ? crumbs[crumbs.length - 1] : null

  return (
    <header className="shrink-0 border-b border-border bg-background/90 backdrop-blur-xl">
      <div className="flex flex-col gap-3 px-3 py-3 pt-12 md:flex-row md:items-center md:justify-between md:gap-4 md:pt-3 lg:px-5">
        <div className="flex min-w-0 flex-1 items-center md:flex-initial">
          <div className="min-w-0 rounded-xl border border-border bg-card px-3 py-2 shadow-sm ring-1 ring-black/[0.04]">
            <Breadcrumb className="min-w-0">
              <BreadcrumbList className="flex-nowrap text-muted-foreground">
                <BreadcrumbItem>
                  <BreadcrumbLink asChild>
                    <Link
                      href="/dashboard"
                      className="font-medium text-foreground transition-colors hover:text-primary"
                    >
                      Arciin
                    </Link>
                  </BreadcrumbLink>
                </BreadcrumbItem>
                {parentCrumb ? (
                  <>
                    <BreadcrumbSeparator className="hidden md:block" />
                    <BreadcrumbItem className="hidden max-w-[10rem] truncate md:block">
                      <BreadcrumbLink asChild>
                        <Link
                          href={parentCrumb.href}
                          className="transition-colors hover:text-primary"
                        >
                          {parentCrumb.label}
                        </Link>
                      </BreadcrumbLink>
                    </BreadcrumbItem>
                  </>
                ) : null}
                {leafCrumb ? (
                  <>
                    <BreadcrumbSeparator />
                    <BreadcrumbItem className="min-w-0 max-w-[12rem] truncate sm:max-w-[18rem]">
                      <BreadcrumbPage className="font-medium text-foreground">
                        {leafCrumb.label}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 md:min-w-0 md:justify-end">
          <DropdownMenu open={commandOpen} onOpenChange={setCommandOpen}>
            <div className="flex min-w-0 w-full max-w-2xl flex-1 items-center gap-2 rounded-xl border border-border bg-card p-2 shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl md:gap-2">
              <div className="hidden min-w-0 shrink-0 items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-xs text-muted-foreground backdrop-blur-md md:flex">
                <span
                  className={`size-2 shrink-0 rounded-full ${
                    connected ? "bg-emerald-500" : "bg-zinc-300"
                  }`}
                />
                <span className="truncate">{connected ? "Realtime live" : "Realtime idle"}</span>
              </div>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="default"
                  className="h-9 min-w-0 flex-1 justify-start gap-2 border-border bg-background px-3 text-sm text-foreground shadow-none hover:bg-muted sm:min-w-[10rem]"
                >
                  <Search className="size-4 shrink-0 text-muted-foreground" />
                  <span className="hidden min-w-0 truncate sm:inline">Search</span>
                  <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground lg:inline-flex">
                    <Command className="size-3" />
                    K
                  </span>
                </Button>
              </DropdownMenuTrigger>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                multiple
                onChange={(event) => {
                  const files = Array.from(event.target.files || [])
                  if (!files.length) {
                    return
                  }
                  window.dispatchEvent(
                    new CustomEvent("arciin:files-selected", {
                      detail: files,
                    })
                  )
                  event.currentTarget.value = ""
                }}
              />
              <Button
                size="default"
                className="h-9 shrink-0 px-4 shadow-none"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-4 shrink-0" />
                <span className="hidden sm:inline">Upload</span>
              </Button>
            </div>
            <DropdownMenuContent
              align="start"
              side="bottom"
              sideOffset={14}
              collisionPadding={16}
              className="z-50 w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 max-w-[min(96vw,36rem)] overflow-visible border-0 bg-transparent p-1 shadow-[0_20px_60px_-18px_rgba(0,0,0,0.22)]"
            >
              <CommandPalettePanel onClose={() => setCommandOpen(false)} />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}

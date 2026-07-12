"use client"

import Link from "next/link"
import { useEffect, useMemo, useRef } from "react"
import { usePathname } from "next/navigation"
import { CloudUpload, Command, Search } from "lucide-react"

import { CommandPalettePanel } from "@/components/app-shell/command-palette-panel"
import { ImportLinkDialog } from "@/components/uploads/import-link-dialog"
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
import { useIsMobile } from "@/hooks/use-mobile"
import { cn } from "@/lib/utils"
import { useUiStore } from "@/lib/stores/ui-store"

/** Per-control floating chip — no full-width header bar. */
const floatChip =
  "pointer-events-auto rounded-xl border border-border bg-card shadow-sm ring-1 ring-black/[0.04] backdrop-blur-xl"

/** Shared height for header chips (breadcrumb, search, upload) */
const headerControlH = "h-10"

export function DashboardHeader() {
  const isMobile = useIsMobile()
  const pathname = usePathname()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const commandOpen = useUiStore((state) => state.commandOpen)
  const setCommandOpen = useUiStore((state) => state.setCommandOpen)

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

  /** Chat is a full-page workspace — no search / import / upload chrome. */
  const isChatPage = pathname === "/chat" || pathname.startsWith("/chat/")

  return (
    <header className="sticky top-0 z-30 shrink-0 bg-transparent pointer-events-none">
      <div className="flex flex-row items-center gap-2 px-3 py-2.5 md:gap-2 lg:gap-3 lg:px-5 lg:py-3">
        {!isMobile ? (
          <div
            className={cn(
              "flex min-w-0 shrink-0 items-center",
              floatChip,
              headerControlH,
              "max-w-[42%] px-2.5 md:max-w-[9.5rem] lg:max-w-[13rem] xl:max-w-[16rem]",
            )}
          >
            <Breadcrumb className="min-w-0 w-full">
              <BreadcrumbList className="flex-nowrap text-muted-foreground">
                <BreadcrumbItem className="shrink-0">
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
                    <BreadcrumbSeparator className="hidden lg:block" />
                    <BreadcrumbItem className="hidden min-w-0 max-w-[7rem] truncate lg:block">
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
                    <BreadcrumbItem className="min-w-0 truncate">
                      <BreadcrumbPage className="truncate font-medium text-foreground">
                        {leafCrumb.label}
                      </BreadcrumbPage>
                    </BreadcrumbItem>
                  </>
                ) : null}
              </BreadcrumbList>
            </Breadcrumb>
          </div>
        ) : null}

        {!isChatPage ? (
          <div className="flex min-w-0 flex-1 flex-nowrap items-center justify-end gap-1.5 md:gap-2">
            <DropdownMenu open={commandOpen} onOpenChange={setCommandOpen}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  className={cn(
                    floatChip,
                    headerControlH,
                    "flex min-w-0 flex-1 items-center gap-2 px-3 text-left text-sm transition-colors hover:bg-zinc-50/90 md:min-w-[7rem] lg:min-w-[12rem] xl:min-w-[18rem] xl:max-w-[42rem]",
                  )}
                >
                  <Search className="size-4 shrink-0 text-zinc-400" />
                  <span className="min-w-0 flex-1 truncate font-normal text-zinc-400 lg:hidden">
                    Search
                  </span>
                  <span className="hidden min-w-0 flex-1 truncate font-normal text-zinc-400 lg:inline">
                    Search files, folders, and metadata
                  </span>
                  <span className="ml-auto hidden shrink-0 items-center gap-1 rounded-md border border-zinc-200/80 bg-zinc-100/80 px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 xl:inline-flex">
                    <Command className="size-3" />
                    K
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                side="bottom"
                sideOffset={14}
                collisionPadding={16}
                className="dashboard-main z-50 w-[var(--radix-dropdown-menu-trigger-width)] min-w-0 max-w-[min(96vw,36rem)] overflow-visible border-0 bg-transparent p-1 shadow-[0_20px_60px_-18px_rgba(0,0,0,0.22)]"
              >
                <CommandPalettePanel onClose={() => setCommandOpen(false)} />
              </DropdownMenuContent>
            </DropdownMenu>

            <ImportLinkDialog />

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
              className={cn(
                "pointer-events-auto shrink-0 gap-2 rounded-xl border-0 bg-[color:var(--arciin-accent,#ff4f12)] px-3 text-white shadow-sm hover:bg-[color:var(--arciin-accent-hover,#ff6a33)] focus-visible:ring-[color:var(--arciin-accent,#ff4f12)]/40 lg:px-4",
                headerControlH,
              )}
              onClick={() => fileInputRef.current?.click()}
            >
              <CloudUpload className="size-4 shrink-0" />
              <span className="hidden lg:inline">Upload</span>
            </Button>
          </div>
        ) : (
          <div className="min-w-0 flex-1" aria-hidden />
        )}
      </div>
    </header>
  )
}

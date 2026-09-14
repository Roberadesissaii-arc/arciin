"use client"

import { useSyncExternalStore } from "react"
import { Monitor } from "lucide-react"

import {
  ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL,
  shouldOfferWindowsDesktopDownload,
} from "@arciin/shared"
import { readDesktopPromoHints } from "@/lib/desktop-windows-promo"
import { Button } from "@/components/ui/button"
import { SectionHeader, SettingsCard } from "@/components/settings/settings-panel-primitives"

function useWindowsDesktopDownloadOffer() {
  return useSyncExternalStore(
    () => () => {},
    () => shouldOfferWindowsDesktopDownload(readDesktopPromoHints()),
    () => false,
  )
}

export function WindowsDesktopDownloadCard() {
  const offer = useWindowsDesktopDownloadOffer()
  if (!offer) return null

  return (
    <div data-testid="windows-desktop-settings-download">
      <SettingsCard>
        <SectionHeader
          icon={Monitor}
          title="Arciin Desktop"
          description="Automatically discover, pair and back up this computer."
        />
        <div className="mt-4">
          <Button asChild>
            <a
              href={ARCIIN_WINDOWS_DESKTOP_DOWNLOAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="windows-desktop-settings-download-link"
            >
              Download for Windows
            </a>
          </Button>
        </div>
      </SettingsCard>
    </div>
  )
}

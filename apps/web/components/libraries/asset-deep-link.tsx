"use client"

import { Suspense, useEffect, useRef } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"

import { useAssetPanelIntent } from "@/components/libraries/asset-panel-intent"
import type { AssetSummary } from "@/lib/types/models"

/**
 * `?asset=<id>` on a library or folder page opens the inspector on that file
 * once the page has listed it — how a top-search result "opens" a file. The
 * parameter is removed afterwards so Back and reload do not reopen it.
 */
function AssetDeepLinkInner({ assets }: { assets: AssetSummary[] }) {
  const params = useSearchParams()
  const pathname = usePathname()
  const router = useRouter()
  const intent = useAssetPanelIntent()
  const handled = useRef<string | null>(null)
  const target = params.get("asset")

  useEffect(() => {
    if (!target || !intent || handled.current === target) return
    if (!assets.some((asset) => asset.id === target)) return
    handled.current = target
    intent.open({ assetId: target, section: "overview" })
    const next = new URLSearchParams(params.toString())
    next.delete("asset")
    const qs = next.toString()
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
  }, [target, assets, intent, params, pathname, router])

  return null
}

export function AssetDeepLink({ assets }: { assets: AssetSummary[] }) {
  return (
    <Suspense fallback={null}>
      <AssetDeepLinkInner assets={assets} />
    </Suspense>
  )
}

"use client"

import { useMemo, useState } from "react"
import { FingerprintPattern } from "lucide-react"

import type { PasswordVaultEntry } from "@/lib/types/models"
import {
  resolveVaultBrand,
  vaultBrandIconCandidates,
  vaultBrandInitials,
  vaultBrandTileBg,
  vaultBrandTileFg,
} from "@/lib/passwords/vault-brand"
import { cn } from "@/lib/utils"

type VaultBrandMarkProps = {
  entry: Pick<PasswordVaultEntry, "name" | "url" | "username" | "category" | "notes">
  size?: "sm" | "md" | "lg"
  className?: string
  /** Show generic vault glyph when no brand is detected. */
  fallbackToVault?: boolean
}

export function VaultBrandMark({
  entry,
  size = "md",
  className,
  fallbackToVault = false,
}: VaultBrandMarkProps) {
  const match = resolveVaultBrand(entry)
  const candidates = useMemo(
    () => (match ? vaultBrandIconCandidates(match) : []),
    [match],
  )
  const [candidateIdx, setCandidateIdx] = useState(0)
  const [iconFailed, setIconFailed] = useState(false)

  const iconSrc = candidates[candidateIdx] ?? null
  const showImage = Boolean(iconSrc) && !iconFailed
  const tileFg = vaultBrandTileFg(match)

  const box =
    size === "lg"
      ? "size-14 rounded-2xl text-base"
      : size === "sm"
        ? "size-8 rounded-lg text-[10px]"
        : "size-10 rounded-xl text-[11px]"

  const imageSize = size === "lg" ? "size-8" : size === "sm" ? "size-4" : "size-5"
  const markPx = size === "lg" ? 32 : size === "sm" ? 16 : 22

  if (!match && fallbackToVault) {
    return (
      <div
        className={cn(
          "flex shrink-0 items-center justify-center bg-zinc-900 text-white ring-1 ring-black/10",
          box,
          className,
        )}
        aria-hidden
      >
        <FingerprintPattern className={size === "lg" ? "size-7" : size === "sm" ? "size-4" : "size-5"} />
      </div>
    )
  }

  return (
    <div
      style={{
        backgroundColor: vaultBrandTileBg(match),
        color: tileFg,
      }}
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden font-bold ring-1 ring-black/10",
        box,
        !match && "bg-zinc-100 text-zinc-600",
        !showImage && match && "text-zinc-800",
        className,
      )}
      aria-hidden
    >
      {showImage ? (
        <img
          key={iconSrc}
          src={iconSrc!}
          alt=""
          width={markPx}
          height={markPx}
          className={cn(imageSize, "object-contain")}
          onError={() => {
            if (candidateIdx < candidates.length - 1) {
              setCandidateIdx((i) => i + 1)
              return
            }
            setIconFailed(true)
          }}
        />
      ) : (
        <span>{vaultBrandInitials(match, entry.name)}</span>
      )}
      <span className="sr-only">{match?.label ?? entry.name}</span>
    </div>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { Loader2 } from "lucide-react"

import {
  actionCreateDemoLicense,
  actionDeactivateServer,
  actionDeleteLicense,
  actionRevokeLicense,
} from "@/lib/actions"
import { Button } from "@/components/ui"
import { CopyButton } from "@/components/copy-button"

export function CreateDemoButtons() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastKey, setLastKey] = useState<string | null>(null)

  function create(plan: string) {
    setMessage(null)
    setError(null)
    start(async () => {
      const res = await actionCreateDemoLicense(plan)
      if (!res.ok) {
        setError(res.message)
        return
      }
      setLastKey(res.data.licenseKey)
      setMessage(`${plan.charAt(0).toUpperCase() + plan.slice(1)} license created.`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {(["pro", "team", "business"] as const).map((plan) => (
          <Button key={plan} type="button" disabled={pending} onClick={() => create(plan)}>
            {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Create demo {plan.charAt(0).toUpperCase() + plan.slice(1)}
          </Button>
        ))}
        <Button type="button" variant="outline" disabled={pending} onClick={() => create("free")}>
          Create Free key
        </Button>
      </div>
      {message ? <p className="text-[13px] font-medium text-[var(--good)]">{message}</p> : null}
      {error ? <p className="text-[13px] font-medium text-[var(--bad)]">{error}</p> : null}
      {lastKey ? (
        <div className="code-block flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
          <code className="min-w-0 flex-1 break-all text-[12px] text-[var(--text)]">{lastKey}</code>
          <CopyButton value={lastKey} label="Copy key" />
        </div>
      ) : null}
    </div>
  )
}

export function RevokeButton({ licenseId }: { licenseId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Revoke this license? Activated servers will lose premium after they refresh status.",
            )
          ) {
            return
          }
          setError(null)
          start(async () => {
            const res = await actionRevokeLicense(licenseId)
            if (!res.ok) {
              setError(res.message)
              return
            }
            router.refresh()
          })
        }}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Revoke
      </Button>
      {error ? (
        <p className="max-w-[14rem] text-right text-[11px] text-[var(--bad)]">{error}</p>
      ) : null}
    </div>
  )
}

export function DeactivateServerButton({
  licenseId,
  instanceId,
}: {
  licenseId: string
  instanceId: string
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="outline"
        disabled={pending}
        onClick={() => {
          if (!window.confirm("Deactivate this server activation?")) return
          setError(null)
          start(async () => {
            const res = await actionDeactivateServer(licenseId, instanceId)
            if (!res.ok) {
              setError(res.message)
              return
            }
            router.refresh()
          })
        }}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Deactivate server
      </Button>
      {error ? (
        <p className="max-w-[14rem] text-right text-[11px] text-[var(--bad)]">{error}</p>
      ) : null}
    </div>
  )
}

/**
 * Only rendered for revoked licences — the server refuses to delete an active
 * one, so offering the button there would just produce an error.
 */
export function DeleteButton({ licenseId }: { licenseId: string }) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="danger"
        disabled={pending}
        onClick={() => {
          if (
            !window.confirm(
              "Delete this license permanently? This removes it and its activation history and cannot be undone.",
            )
          ) {
            return
          }
          setError(null)
          start(async () => {
            const res = await actionDeleteLicense(licenseId)
            if (!res.ok) {
              setError(res.message)
              return
            }
            router.refresh()
          })
        }}
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : null}
        Delete
      </Button>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  )
}

"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Check, Copy, Download, KeyRound, ShieldCheck, ShieldOff, TriangleAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { SettingsPanelError } from "@/components/settings/settings-panel-error"
import {
  beginMfaEnrollment,
  disableMfa,
  getMfaStatus,
  regenerateRecoveryCodes,
  verifyMfaEnrollment,
} from "@/lib/api/auth"
import { toast } from "@/lib/notifications/arciin-toast"

const MFA_QUERY_KEY = ["auth", "mfa"] as const
/** Below this, the account is one bad day from having no way back in. */
const LOW_RECOVERY_CODES = 3
/** Issued as a set; the remaining count is only meaningful against it. */
const RECOVERY_CODE_TOTAL = 10

type Stage =
  | { name: "idle" }
  | { name: "password" }
  | { name: "scan"; secret: string; qrDataUrl: string }
  | { name: "codes"; codes: string[] }

/**
 * Two-factor authentication.
 *
 * The order of the enrolment steps is the security-relevant part. The secret
 * is created only after the current password is re-entered, MFA is not
 * switched on until a code proves the authenticator actually holds that
 * secret, and the recovery codes are shown once, after which only hashes
 * exist. Turning it off asks for the password and a live code, so a borrowed
 * session cannot quietly remove the second factor.
 */
export function MfaPanel() {
  const queryClient = useQueryClient()
  const [stage, setStage] = useState<Stage>({ name: "idle" })
  const [password, setPassword] = useState("")
  const [code, setCode] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)

  const status = useQuery({
    queryKey: MFA_QUERY_KEY,
    queryFn: ({ signal }) => getMfaStatus(signal),
  })

  const reset = () => {
    setStage({ name: "idle" })
    setPassword("")
    setCode("")
    setAcknowledged(false)
    void queryClient.invalidateQueries({ queryKey: MFA_QUERY_KEY })
  }

  const begin = useMutation({
    mutationFn: () => beginMfaEnrollment({ password }),
    onSuccess: (data) => {
      // The secret is in memory for as long as this screen is open and is
      // never written anywhere it could outlive the tab.
      setStage({ name: "scan", secret: data.secret, qrDataUrl: data.qrDataUrl })
      setPassword("")
    },
    onError: (error) =>
      toast.error("Could not start setup", {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  const verify = useMutation({
    mutationFn: () => verifyMfaEnrollment({ totp: code }),
    onSuccess: (data) => {
      setStage({ name: "codes", codes: data.recoveryCodes })
      setCode("")
    },
    onError: (error) =>
      toast.error("That code was not accepted", {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  const turnOff = useMutation({
    mutationFn: () => disableMfa({ password, totp: code }),
    onSuccess: () => {
      toast.success("Two-factor authentication turned off")
      reset()
    },
    onError: (error) =>
      toast.error("Could not turn it off", {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  const regenerate = useMutation({
    mutationFn: () => regenerateRecoveryCodes({ password, totp: code }),
    onSuccess: (data) => {
      setStage({ name: "codes", codes: data.recoveryCodes })
      setPassword("")
      setCode("")
    },
    onError: (error) =>
      toast.error("Could not replace the codes", {
        description: error instanceof Error ? error.message : undefined,
      }),
  })

  if (status.isLoading) return <Skeleton className="h-48 w-full rounded-2xl" />
  if (status.error) {
    return (
      <SettingsPanelError
        message="Could not load two-factor settings."
        hint={status.error instanceof Error ? status.error.message : undefined}
      />
    )
  }

  const data = status.data
  const enabled = Boolean(data?.enabled)
  const remaining = data?.recoveryCodesRemaining ?? 0
  const codesLow = enabled && remaining <= LOW_RECOVERY_CODES

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/25">
            {enabled ? (
              <ShieldCheck className="size-5 text-primary" />
            ) : (
              <ShieldOff className="size-5 text-muted-foreground" />
            )}
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">
              Multi-factor authentication
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {enabled
                ? `Your account asks for an authenticator code when signing in · ${remaining} of ${RECOVERY_CODE_TOTAL} recovery codes left`
                : "Not set up. A password on its own is the only thing between someone and this server."}
            </p>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {codesLow ? (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-foreground">
            <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span>
              <span className="font-medium">Recovery codes need attention.</span> {remaining} left.
              If you lose the authenticator with none of these saved, there is no way back into
              this account.
            </span>
          </p>
        ) : null}

        {stage.name === "idle" && !enabled ? (
          <Button onClick={() => setStage({ name: "password" })}>
            Set up two-factor authentication
          </Button>
        ) : null}

        {stage.name === "idle" && enabled ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setStage({ name: "password" })}>
              Replace recovery codes
            </Button>
            <Button variant="destructive" onClick={() => setStage({ name: "password" })}>
              Turn off
            </Button>
          </div>
        ) : null}

        {stage.name === "password" ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Confirm your password to continue.
              {enabled ? " You will also need a current code." : null}
            </p>
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
            {enabled ? (
              <Input
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Six-digit code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            ) : null}
            <div className="flex flex-wrap gap-2">
              {enabled ? (
                <>
                  <Button
                    onClick={() => regenerate.mutate()}
                    disabled={regenerate.isPending || !password || !code}
                  >
                    Replace codes
                  </Button>
                  <Button
                    variant="destructive"
                    onClick={() => turnOff.mutate()}
                    disabled={turnOff.isPending || !password || !code}
                  >
                    Turn off MFA
                  </Button>
                </>
              ) : (
                <Button onClick={() => begin.mutate()} disabled={begin.isPending || !password}>
                  {begin.isPending ? "Starting…" : "Continue"}
                </Button>
              )}
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {stage.name === "scan" ? (
          <div className="space-y-3">
            <p className="text-[13px] text-muted-foreground">
              Scan this with an authenticator app, then enter the code it shows.
            </p>
            {/*
              Named rather than prescribed. This is standard TOTP — it needs no
              account with anybody, and once enrolled it keeps working with no
              network at all.
            */}
            <p className="text-[12px] text-muted-foreground">
              Works with most authenticator apps, including Google Authenticator,
              Microsoft Authenticator, 1Password and other TOTP apps. No account with
              anyone is required, and codes keep working offline.
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URI generated in this request; there is no remote asset to optimise. */}
            <img
              src={stage.qrDataUrl}
              alt="QR code for enrolling this account in an authenticator app"
              /* White plate and generous quiet zone: a scanner needs the
                 margin, and a dark theme would otherwise invert it away. */
              className="rounded-lg border border-border bg-white p-3"
              width={232}
              height={232}
            />
            <div className="space-y-1">
              <p className="text-[12px] text-muted-foreground">
                Can&apos;t scan? Enter this key by hand. It is shown now and never again.
              </p>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 font-mono text-[12px] text-foreground"
                onClick={() => {
                  void navigator.clipboard?.writeText(stage.secret)
                  toast.success("Setup key copied")
                }}
              >
                {stage.secret}
                <Copy className="size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <Input
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="Six-digit code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
            />
            <div className="flex gap-2">
              <Button onClick={() => verify.mutate()} disabled={verify.isPending || !code}>
                {verify.isPending ? "Checking…" : "Verify and turn on"}
              </Button>
              <Button variant="ghost" onClick={reset}>
                Cancel
              </Button>
            </div>
          </div>
        ) : null}

        {stage.name === "codes" ? (
          <div className="space-y-3">
            <p className="flex items-start gap-2 rounded-lg border border-border bg-muted/25 px-3 py-2 text-[12px] text-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0 text-primary" />
              <span>
                <span className="font-medium">Save these now.</span> Each one works once, and this
                is the only time they are shown — only hashes are kept. They are the way back in if
                you lose the authenticator.
              </span>
            </p>
            <ul className="grid grid-cols-1 gap-1 rounded-lg border border-border bg-card p-3 font-mono text-[12px] sm:grid-cols-2">
              {stage.codes.map((recoveryCode) => (
                <li key={recoveryCode} className="text-foreground">
                  {recoveryCode}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  void navigator.clipboard?.writeText(stage.codes.join("\n"))
                  toast.success("Recovery codes copied")
                }}
              >
                <Copy className="size-3.5" /> Copy all
              </Button>
              {/*
                Offered, never automatic. A file appearing in Downloads without
                being asked for is a surprise, and these are credentials.
              */}
              <Button
                variant="outline"
                onClick={() => {
                  const blob = new Blob(
                    [
                      "Arciin recovery codes\n",
                      "Each code works once. Keep them somewhere you can reach without your phone.\n\n",
                      stage.codes.join("\n"),
                      "\n",
                    ],
                    { type: "text/plain" },
                  )
                  const url = URL.createObjectURL(blob)
                  const link = document.createElement("a")
                  link.href = url
                  link.download = "arciin-recovery-codes.txt"
                  link.click()
                  URL.revokeObjectURL(url)
                }}
              >
                <Download className="size-3.5" /> Download
              </Button>
              <label className="flex items-center gap-2 text-[12px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={acknowledged}
                  onChange={(event) => setAcknowledged(event.target.checked)}
                />
                I have saved these somewhere safe
              </label>
            </div>
            <Button onClick={reset} disabled={!acknowledged}>
              <Check className="size-3.5" /> Done
            </Button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

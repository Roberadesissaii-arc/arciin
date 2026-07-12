"use client"

type PasswordVaultCredentialsSectionProps = {
  pinConfigured: boolean
  lockRequired: boolean
  secretsVisible: boolean
  actions?: React.ReactNode
}

export function PasswordVaultCredentialsSection({
  pinConfigured,
  lockRequired,
  secretsVisible,
  actions,
}: PasswordVaultCredentialsSectionProps) {
  const description =
    lockRequired && !secretsVisible
      ? "Passwords stay hidden until you unlock the vault or use the eye icon on a row. After you reveal a password, copy works without asking again."
      : pinConfigured
        ? "Your vault is encrypted on disk. Use the eye icon on each row to show or hide that password."
        : "Select a row to preview the credential on the right. Copy, edit, or open the site from the detail panel."

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h3 className="font-heading text-base font-semibold tracking-tight text-foreground">
            Saved credentials
          </h3>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  )
}

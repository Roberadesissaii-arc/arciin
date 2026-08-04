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
    <section>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <h3 className="shrink-0 font-heading text-base font-semibold tracking-tight text-foreground">
            Saved credentials
          </h3>
          <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={description}>
            {description}
          </p>
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">{actions}</div>
        ) : null}
      </div>
    </section>
  )
}

import type { ButtonHTMLAttributes, ReactNode } from "react"

export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ")
}

export function Card({
  children,
  className,
  muted,
}: {
  children: ReactNode
  className?: string
  muted?: boolean
}) {
  return (
    <div className={cn(muted ? "account-card-muted" : "account-card", "p-5 sm:p-6", className)}>
      {children}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  const tone =
    status === "active"
      ? "ok"
      : status === "grace"
        ? "warn"
        : status === "expired" || status === "revoked" || status === "inactive"
          ? "bad"
          : "off"
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
        tone === "ok" && "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
        tone === "warn" && "bg-amber-50 text-amber-800 ring-1 ring-amber-200",
        tone === "bad" && "bg-red-50 text-red-700 ring-1 ring-red-200",
        tone === "off" && "bg-[var(--surface-2)] text-[var(--text-muted)] ring-1 ring-[var(--border)]",
      )}
    >
      {status}
    </span>
  )
}

export function Button({
  children,
  className,
  variant = "primary",
  type = "button",
  disabled,
  onClick,
  ...rest
}: {
  children: ReactNode
  className?: string
  variant?: "primary" | "outline" | "ghost" | "danger"
  type?: "button" | "submit"
  disabled?: boolean
  onClick?: () => void
} & ButtonHTMLAttributes<HTMLButtonElement>) {
  const base =
    variant === "primary"
      ? "btn-primary"
      : variant === "danger"
        ? "btn-danger"
        : variant === "ghost"
          ? "btn-ghost"
          : "btn-secondary"
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      className={cn(base, className)}
      {...rest}
    >
      {children}
    </button>
  )
}

export function FieldLabel({ children }: { children: ReactNode }) {
  return (
    <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--text-faint)]">
      {children}
    </p>
  )
}

export function PageHeader({
  eyebrow,
  title,
  description,
}: {
  eyebrow?: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-2xl">
      {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
      <h1
        className={cn(
          "font-display text-balance text-[clamp(1.75rem,4vw,2.5rem)] font-bold leading-[1.08] tracking-[-0.03em] text-[var(--text)]",
          eyebrow ? "mt-4" : "",
        )}
      >
        {title}
      </h1>
      <p className="mt-3 max-w-[52ch] text-[1rem] leading-relaxed text-[var(--text-muted)]">
        {description}
      </p>
    </div>
  )
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function formatDateShort(iso: string | null | undefined) {
  if (!iso) return "—"
  try {
    return new Date(iso).toLocaleDateString()
  } catch {
    return iso
  }
}

export function planTitle(plan: string) {
  if (!plan || plan === "none") return "None"
  return plan.charAt(0).toUpperCase() + plan.slice(1)
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <Card className="min-h-[7rem]">
      <FieldLabel>{label}</FieldLabel>
      <p className="font-display mt-2 text-xl font-semibold tracking-tight text-[var(--text)]">
        {value}
      </p>
      {hint ? <p className="mt-1 text-[13px] text-[var(--text-muted)]">{hint}</p> : null}
    </Card>
  )
}

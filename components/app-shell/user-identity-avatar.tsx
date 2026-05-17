import { cn } from "@/lib/utils"

/** Orange identity mark — matches Account → Identity (medium rounded square). */
export function UserIdentityAvatar({
  name,
  size = "md",
  className,
}: {
  name: string
  size?: "sm" | "md"
  className?: string
}) {
  const letter = (name.trim()[0] ?? "?").toUpperCase()
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center rounded-xl bg-[var(--arciin-accent)] font-bold text-white shadow-sm",
        size === "sm" ? "size-8 text-[13px]" : "size-10 text-[15px]",
        className,
      )}
      aria-hidden
    >
      {letter}
    </div>
  )
}

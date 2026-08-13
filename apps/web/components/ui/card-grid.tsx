"use client"

import type { ReactNode } from "react"
import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

export type CardGridItem = {
  id: string | number
  title: string
  description?: string
  linkText: string
  /** Optional photo (legacy). Prefer `icon` for abstract cards. */
  imageSrc?: string
  /** Lucide (or custom) icon — shown on an abstract Arciin panel. */
  icon?: ReactNode
  /** In-app path or external URL. Prefer `onSelect` for chat templates. */
  linkHref?: string
  /** When set, card acts as a button (e.g. inject a chat prompt). */
  onSelect?: () => void
}

export type CardGridProps = {
  title?: string
  subtitle?: string
  items: CardGridItem[]
  className?: string
  /** Grid columns; default 3 on large screens. */
  columns?: 2 | 3 | 4
  /** Compact cards (chat templates). */
  compact?: boolean
}

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { y: 16, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: { type: "spring" as const, stiffness: 120, damping: 18 },
  },
}

/**
 * Abstract icon panel — zinc surface + orange accent mark.
 * Used when the card has an icon instead of a photograph.
 */
function AbstractIconPanel({
  icon,
  compact,
}: {
  icon: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={cn(
        "relative overflow-hidden",
        compact ? "aspect-[16/9]" : "aspect-[16/10]",
        "bg-gradient-to-br from-zinc-100 via-zinc-50 to-zinc-100",
      )}
      aria-hidden
    >
      {/* Soft geometric backdrop */}
      <div className="absolute -right-6 -top-8 size-28 rounded-full bg-primary/[0.07] blur-0" />
      <div className="absolute -bottom-10 -left-6 size-32 rounded-full bg-zinc-200/80" />
      <div className="absolute right-4 top-1/2 size-16 -translate-y-1/2 rounded-2xl border border-zinc-200/90 bg-white/60" />

      {/* Icon tile */}
      <div className="relative flex size-full items-center justify-center">
        <div
          className={cn(
            "flex items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm",
            "ring-1 ring-inset ring-primary/10",
            "transition-transform duration-300 group-hover:scale-105 group-hover:bg-primary/15",
            compact ? "size-12 sm:size-14" : "size-14 sm:size-16",
          )}
        >
          <span className={cn("flex items-center justify-center", compact ? "[&>svg]:size-6" : "[&>svg]:size-7")}>
            {icon}
          </span>
        </div>
      </div>

      {/* Thin orange accent bar at bottom of panel */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-gradient-to-r from-transparent via-primary/70 to-transparent" />
    </div>
  )
}

/**
 * Responsive card grid with hover motion — used for chat templates and similar
 * discovery UIs. Matches Arciin zinc surfaces and primary accent.
 */
export function CardGrid({
  title,
  subtitle,
  items,
  className,
  columns = 3,
  compact = false,
}: CardGridProps) {
  const colClass =
    columns === 4
      ? "sm:grid-cols-2 lg:grid-cols-4"
      : columns === 2
        ? "sm:grid-cols-2"
        : "sm:grid-cols-2 lg:grid-cols-3"

  return (
    <section className={cn("w-full", className)}>
      {title || subtitle ? (
        <div className={cn("text-center", compact ? "mb-4 sm:mb-5" : "mb-6 sm:mb-8")}>
          {title ? (
            <h2
              className={cn(
                "font-heading font-semibold tracking-tight text-foreground",
                compact ? "text-base sm:text-lg" : "text-lg sm:text-xl",
              )}
            >
              {title}
            </h2>
          ) : null}
          {subtitle ? (
            <p
              className={cn(
                "mx-auto mt-1.5 max-w-md leading-relaxed text-muted-foreground",
                compact ? "text-[12px]" : "text-[13px]",
              )}
            >
              {subtitle}
            </p>
          ) : null}
          <span
            className={cn(
              "mx-auto mt-2.5 block h-0.5 rounded-full bg-primary sm:mt-3",
              compact ? "w-12 sm:w-14" : "w-14 sm:w-16",
            )}
            aria-hidden
          />
        </div>
      ) : null}

      <motion.div
        className={cn("grid grid-cols-1", compact ? "gap-3" : "gap-4", colClass)}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {items.map((item) => {
          const media =
            item.icon != null ? (
              <AbstractIconPanel icon={item.icon} compact={compact} />
            ) : item.imageSrc ? (
              <div
                className={cn(
                  "overflow-hidden bg-zinc-100",
                  compact ? "aspect-[16/9]" : "aspect-[16/10]",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageSrc}
                  alt=""
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
            ) : (
              <div
                className={cn(
                  "bg-zinc-100",
                  compact ? "aspect-[16/9]" : "aspect-[16/10]",
                )}
              />
            )

          const body = (
            <div className="flex h-full flex-col">
              {media}
              <div
                className={cn(
                  "flex flex-1 flex-col",
                  compact ? "gap-1.5 p-3" : "gap-2 p-4",
                )}
              >
                <h3
                  className={cn(
                    "font-semibold leading-snug text-foreground",
                    compact ? "text-[13px]" : "text-[14px]",
                  )}
                >
                  {item.title}
                </h3>
                {item.description ? (
                  <p
                    className={cn(
                      "line-clamp-2 leading-relaxed text-muted-foreground",
                      compact ? "text-[11px]" : "text-[12px]",
                    )}
                  >
                    {item.description}
                  </p>
                ) : null}
                <div
                  className={cn(
                    "mt-auto flex items-center font-semibold text-primary",
                    compact ? "pt-0.5 text-[11px]" : "pt-1 text-[12px]",
                  )}
                >
                  {item.linkText}
                  <ArrowRight
                    className={cn(
                      "ml-1.5 transition-transform duration-300 group-hover:translate-x-0.5",
                      compact ? "size-3" : "size-3.5",
                    )}
                  />
                </div>
              </div>
            </div>
          )

          const sharedClass = cn(
            "group block overflow-hidden border border-border bg-card shadow-sm",
            compact ? "rounded-xl" : "rounded-2xl",
            "transition-colors duration-300 hover:border-primary/40 hover:shadow-md",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35",
            "text-left",
          )

          if (item.onSelect) {
            return (
              <motion.button
                key={item.id}
                type="button"
                className={sharedClass}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
                onClick={item.onSelect}
              >
                {body}
              </motion.button>
            )
          }

          const href = item.linkHref ?? "#"
          const external = href.startsWith("http")
          if (external) {
            return (
              <motion.a
                key={item.id}
                href={href}
                target="_blank"
                rel="noreferrer noopener"
                className={sharedClass}
                variants={itemVariants}
                whileHover={{ y: -4 }}
                transition={{ type: "spring", stiffness: 320, damping: 24 }}
              >
                {body}
              </motion.a>
            )
          }

          return (
            <motion.div
              key={item.id}
              variants={itemVariants}
              whileHover={{ y: -4 }}
              transition={{ type: "spring", stiffness: 320, damping: 24 }}
            >
              <Link href={href} className={sharedClass}>
                {body}
              </Link>
            </motion.div>
          )
        })}
      </motion.div>
    </section>
  )
}

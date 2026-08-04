"use client"

import Link from "next/link"
import { motion } from "framer-motion"
import { ArrowRight } from "lucide-react"

import { cn } from "@/lib/utils"

export type CardGridItem = {
  id: string | number
  imageSrc: string
  title: string
  description?: string
  linkText: string
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
 * Responsive card grid with hover motion — used for chat templates and similar
 * discovery UIs. Matches Arciin zinc surfaces and primary accent.
 */
export function CardGrid({
  title,
  subtitle,
  items,
  className,
  columns = 3,
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
        <div className="mb-6 text-center sm:mb-8">
          {title ? (
            <h2 className="font-heading text-lg font-semibold tracking-tight text-foreground sm:text-xl">
              {title}
            </h2>
          ) : null}
          {subtitle ? (
            <p className="mx-auto mt-1.5 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              {subtitle}
            </p>
          ) : null}
          {/* Slightly longer accent under the header copy */}
          <span
            className="mx-auto mt-3 block h-0.5 w-14 rounded-full bg-primary sm:w-16"
            aria-hidden
          />
        </div>
      ) : null}

      <motion.div
        className={cn("grid grid-cols-1 gap-4", colClass)}
        variants={containerVariants}
        initial="hidden"
        animate="visible"
      >
        {items.map((item) => {
          const body = (
            <div className="flex h-full flex-col">
              <div className="aspect-[16/10] overflow-hidden bg-zinc-100">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.imageSrc}
                  alt=""
                  className="size-full object-cover transition-transform duration-300 group-hover:scale-105"
                  loading="lazy"
                />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-4">
                <h3 className="text-[14px] font-semibold leading-snug text-foreground">
                  {item.title}
                </h3>
                {item.description ? (
                  <p className="line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
                    {item.description}
                  </p>
                ) : null}
                <div className="mt-auto flex items-center pt-1 text-[12px] font-semibold text-primary">
                  {item.linkText}
                  <ArrowRight className="ml-1.5 size-3.5 transition-transform duration-300 group-hover:translate-x-0.5" />
                </div>
              </div>
            </div>
          )

          const sharedClass = cn(
            "group block overflow-hidden rounded-2xl border border-border bg-card shadow-sm",
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

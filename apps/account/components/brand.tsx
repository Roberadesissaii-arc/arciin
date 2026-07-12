/** Brand lockup matching arciin-web marketing (orange mark + Arciin.) */

export function MarkLetter({ height = 22 }: { height?: number }) {
  const width = Math.round(height * (245 / 320))
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/arciin-mark.svg"
      alt=""
      width={width}
      height={height}
      className="shrink-0"
      aria-hidden
    />
  )
}

/** Dark nav bar: solid white wordmark + orange period (high contrast on glass bar) */
export function BrandLockupNav({ markHeight = 20 }: { markHeight?: number }) {
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <MarkLetter height={markHeight} />
      <span className="flex min-w-0 items-baseline truncate">
        <span
          className="font-display text-base font-bold tracking-tight sm:text-lg"
          style={{ color: "#ffffff" }}
        >
          Arciin
        </span>
        <span
          className="font-display text-xl font-black leading-none sm:text-2xl"
          style={{ color: "#ff4f12" }}
        >
          .
        </span>
      </span>
    </span>
  )
}

/** Light surfaces: dark wordmark + orange period */
export function BrandLockup({ markHeight = 22 }: { markHeight?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <MarkLetter height={markHeight} />
      <span className="font-display text-lg font-bold tracking-tight text-[var(--text)]">
        Arciin<span className="text-[var(--accent)]">.</span>
      </span>
    </span>
  )
}

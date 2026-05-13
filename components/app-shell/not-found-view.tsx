import { NotFoundActions } from "@/app/not-found-actions"

const PARTICLES = [
  { id: 0, x: 8, y: 12, size: 2, delay: 0 },
  { id: 1, x: 22, y: 78, size: 1.5, delay: 1.2 },
  { id: 2, x: 38, y: 33, size: 2.5, delay: 0.6 },
  { id: 3, x: 55, y: 88, size: 1, delay: 2.1 },
  { id: 4, x: 67, y: 22, size: 2, delay: 0.3 },
  { id: 5, x: 80, y: 61, size: 1.5, delay: 1.7 },
  { id: 6, x: 92, y: 44, size: 2, delay: 0.9 },
  { id: 7, x: 14, y: 55, size: 1, delay: 2.5 },
  { id: 8, x: 47, y: 6, size: 2.5, delay: 1.4 },
  { id: 9, x: 73, y: 91, size: 1.5, delay: 0.7 },
  { id: 10, x: 30, y: 70, size: 1, delay: 3.1 },
  { id: 11, x: 85, y: 15, size: 2, delay: 1.9 },
  { id: 12, x: 5, y: 40, size: 1.5, delay: 2.8 },
  { id: 13, x: 60, y: 50, size: 1, delay: 0.4 },
  { id: 14, x: 42, y: 95, size: 2, delay: 1.1 },
  { id: 15, x: 95, y: 72, size: 1.5, delay: 3.5 },
]

function NotFoundInner({ compact }: { compact: boolean }) {
  return (
    <>
      <style>{`
        @keyframes arciinFloatUp {
          0%   { transform: translateY(0px) scale(1);   opacity: 0.35; }
          100% { transform: translateY(-20px) scale(1.4); opacity: 0.08; }
        }
      `}</style>

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(255,79,18,0.12) 0%, transparent 70%)",
        }}
      />

      {PARTICLES.map((p) => (
        <div
          key={p.id}
          className="pointer-events-none absolute rounded-full"
          style={{
            left: `${p.x}%`,
            top: `${p.y}%`,
            width: p.size,
            height: p.size,
            background: "rgba(255,122,70,0.45)",
            animation: `arciinFloatUp 5s ease-in-out ${p.delay}s infinite alternate`,
          }}
        />
      ))}

      <div
        className={`relative z-10 flex flex-col items-center px-6 text-center ${compact ? "max-w-md py-2" : "max-w-lg"}`}
      >
        <div className="relative mb-4" style={{ lineHeight: 1 }}>
          <p
            className={`font-black tracking-tighter ${compact ? "text-[72px] sm:text-[88px]" : "text-[120px]"}`}
            style={{
              color: "transparent",
              WebkitTextStroke: "1px rgba(255,255,255,0.06)",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            404
          </p>
          <p
            className={`absolute inset-0 font-black tracking-tighter ${compact ? "text-[72px] sm:text-[88px]" : "text-[120px]"}`}
            style={{
              color: "transparent",
              background:
                "linear-gradient(135deg, #FFB08F 0%, #FF4F12 55%, rgba(255,79,18,0.25) 100%)",
              WebkitBackgroundClip: "text",
              backgroundClip: "text",
              userSelect: "none",
              lineHeight: 1,
            }}
          >
            404
          </p>
        </div>

        <h1 className="mb-2 text-[20px] font-bold tracking-tight text-white sm:text-[22px]">
          Page not found
        </h1>
        <p className="mb-8 text-[13px] leading-relaxed sm:mb-10 sm:text-[14px]" style={{ color: "rgba(255,255,255,0.38)" }}>
          The page you&apos;re looking for doesn&apos;t exist or has been moved.
          <br />
          Head home and we&apos;ll route you to the right place.
        </p>

        <NotFoundActions />

        <p
          className="mt-10 text-[11px] font-medium uppercase sm:mt-14"
          style={{ color: "rgba(255,255,255,0.13)", letterSpacing: "0.25em" }}
        >
          Arciin
        </p>
      </div>
    </>
  )
}

/**
 * `embedded` — centered card inside the dashboard main column (sidebar stays).
 * `fullscreen` — whole viewport for routes outside the dashboard shell.
 */
export function NotFoundView({ variant }: { variant: "fullscreen" | "embedded" }) {
  if (variant === "embedded") {
    return (
      <div className="flex w-full min-w-0 flex-1 flex-col items-center justify-center px-4 py-10">
        <div
          className="relative isolate w-full max-w-lg overflow-hidden rounded-3xl border border-white/[0.1] bg-[#09090B] px-2 py-10 shadow-[0_24px_80px_-24px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.06] sm:px-4 sm:py-12"
          style={{ minHeight: "min(65vh, 26rem)" }}
        >
          <NotFoundInner compact />
        </div>
      </div>
    )
  }

  return (
    <div
      className="relative flex min-h-[100dvh] select-none flex-col items-center justify-center overflow-hidden"
      style={{ background: "#09090B" }}
    >
      <NotFoundInner compact={false} />
    </div>
  )
}

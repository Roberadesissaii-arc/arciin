import { spawn } from "node:child_process"

import { MediaToolError, describeExit, sanitizeToolOutput } from "./media-tool-error"

/**
 * Running a long external tool while watching it work.
 *
 * `execFile` was the obvious choice and it was the wrong one, for three reasons
 * that only showed up on real media.
 *
 * It buffers. Progress arrives while the process runs, and a promise that
 * resolves at the end cannot report it — the separator was emitting `39/122` and
 * Arciin had no way to see it.
 *
 * Its timeout is a wall clock. A 12-minute video needed about 92 minutes of
 * separation on this CPU, and the 30-minute default killed it at 39 of 122
 * chunks, after half an hour of work, with no partial result. A wall clock
 * cannot tell "slow" from "stuck", and on hardware where slow is normal it
 * reliably punishes the wrong one.
 *
 * And it holds everything in memory to hand back at the end, when what a failure
 * actually needs is the last few kilobytes.
 *
 * So: stream the output, hand each chunk to the caller, keep a bounded tail for
 * diagnostics, and guard against hanging with inactivity rather than duration.
 */

export type StreamingRunOptions = {
  /** Called with every chunk of stdout and stderr, undecoded of meaning. */
  onOutput?: (chunk: string) => void
  signal?: AbortSignal
  /**
   * How long the process may produce no output at all before it is considered
   * hung. This is the real guard: a healthy separation prints a frame every
   * tens of seconds, so silence for many minutes means something is wrong,
   * whereas taking two hours simply means the file is long.
   */
  stallTimeoutMs?: number
  /**
   * An absolute ceiling, off by default.
   *
   * Deliberately not set for separation: any figure picked here is a guess about
   * hardware and media length, and getting it wrong throws away completed work.
   */
  timeoutMs?: number
  /** How much output to keep for a failure message. */
  tailBytes?: number
  /** Receives the full output for on-disk diagnostics, if the caller wants it. */
  onComplete?: (fullOutput: string) => void | Promise<void>
}

/** Fifteen minutes of total silence. Far longer than any healthy frame gap. */
export const DEFAULT_STALL_TIMEOUT_MS = 15 * 60 * 1000

const DEFAULT_TAIL_BYTES = 64 * 1024

export type StreamingRunResult = {
  /** The bounded tail, sanitised. */
  output: string
  exitCode: number
}

export async function runStreaming(
  command: string,
  args: string[],
  options: StreamingRunOptions = {},
): Promise<StreamingRunResult> {
  const stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  const tailBytes = options.tailBytes ?? DEFAULT_TAIL_BYTES
  const toolName = command.split("/").pop() ?? command

  return new Promise<StreamingRunResult>((resolve, reject) => {
    /**
     * Its own process group, so the whole tree can be ended.
     *
     * Demucs runs under torch, which forks workers of its own, and signalling
     * only the process we spawned leaves those alive: burning CPU on a machine
     * that has none to spare, and holding the pipe open so `close` never fires.
     * Measured with a stand-in: killing the direct child alone took the full
     * thirty seconds to be noticed, because a surviving grandchild still owned
     * the write end.
     */
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], detached: true })

    /**
     * A ring of recent output rather than all of it.
     *
     * A two-hour separation prints megabytes of progress frames; keeping them
     * all to build an error message that shows the last few lines is a slow
     * memory leak with extra steps.
     */
    let tail = ""
    let full = ""
    let settled = false
    let stalled = false

    let stallTimer: NodeJS.Timeout | undefined
    let absoluteTimer: NodeJS.Timeout | undefined

    const clearTimers = () => {
      if (stallTimer) clearTimeout(stallTimer)
      if (absoluteTimer) clearTimeout(absoluteTimer)
    }

    /** The group if we can, the process alone if the group has already gone. */
    const signalTree = (signal: NodeJS.Signals) => {
      try {
        if (child.pid) process.kill(-child.pid, signal)
        else child.kill(signal)
      } catch {
        try {
          child.kill(signal)
        } catch {
          // Already dead. Nothing to do and nothing worth reporting.
        }
      }
    }

    const kill = (why: "stall" | "timeout" | "abort") => {
      if (why === "stall") stalled = true
      clearTimers()
      // SIGTERM first: Python cleans up its temp files on it.
      signalTree("SIGTERM")
      // If it ignores that, insist — a wedged process must not hold the queue.
      const insist = setTimeout(() => signalTree("SIGKILL"), 10_000)
      insist.unref?.()
    }

    const armStall = () => {
      if (stallTimer) clearTimeout(stallTimer)
      stallTimer = setTimeout(() => kill("stall"), stallTimeoutMs)
      stallTimer.unref?.()
    }

    if (options.timeoutMs) {
      absoluteTimer = setTimeout(() => kill("timeout"), options.timeoutMs)
      absoluteTimer.unref?.()
    }

    const onAbort = () => kill("abort")
    options.signal?.addEventListener("abort", onAbort, { once: true })

    const consume = (chunk: Buffer) => {
      const text = chunk.toString("utf8")
      full += text
      tail = (tail + text).slice(-tailBytes)
      // Any output at all is proof of life, whether or not it parses.
      armStall()
      options.onOutput?.(text)
    }

    child.stdout?.on("data", consume)
    child.stderr?.on("data", consume)
    armStall()

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimers()
      options.signal?.removeEventListener("abort", onAbort)
      void Promise.resolve(options.onComplete?.(full)).catch(() => {}).then(fn)
    }

    child.on("error", (error) => {
      finish(() =>
        reject(
          new MediaToolError({
            tool: toolName,
            summary: `${toolName} could not be started.`,
            detail: error instanceof Error ? error.message : String(error),
          }),
        ),
      )
    })

    /**
     * Settle on exit, with a short grace period for the streams.
     *
     * `close` waits for every stdio pipe to end, which an orphaned grandchild
     * can delay indefinitely. `exit` is the authoritative word on the process we
     * started, so the result is taken from there and `close` merely gets a brief
     * chance to deliver any last output first.
     */
    let exitInfo: { code: number | null; signal: NodeJS.Signals | null } | null = null

    const settle = (code: number | null, signal: NodeJS.Signals | null) => {
      if (code === 0 && !stalled) {
        finish(() => resolve({ output: sanitizeToolOutput(tail), exitCode: 0 }))
        return
      }
      finish(() =>
        reject(
          new MediaToolError({
            tool: toolName,
            summary: describeExit({
              tool: toolName,
              exitCode: code,
              signal,
              stalled,
              stallMinutes: Math.round(stallTimeoutMs / 60_000),
            }),
            detail: tail,
            exitCode: code,
            signal,
          }),
        ),
      )
    }

    child.on("exit", (code, signal) => {
      exitInfo = { code, signal }
      // Half a second for trailing output, then report regardless.
      const grace = setTimeout(() => settle(code, signal), 500)
      grace.unref?.()
    })

    child.on("close", () => {
      if (exitInfo) settle(exitInfo.code, exitInfo.signal)
    })
  })
}

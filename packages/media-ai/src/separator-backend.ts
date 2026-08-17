import { execFile } from "node:child_process"
import { access, readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type {
  AudioSeparationBackend,
  AudioStems,
  SeparationRequest,
} from "./audio-separation"
import { DEFAULT_STALL_TIMEOUT_MS, runStreaming } from "./run-streaming"
import { SeparatorProgressReader } from "./separator-progress"

const run = promisify(execFile)

/**
 * Dialogue and background, split by an ONNX vocal-separation model.
 *
 * Wraps `python-audio-separator`, which runs MDX/UVR models locally — nothing
 * about the original soundtrack leaves the server. It is invoked as a
 * subprocess rather than embedded because it is Python, and because separation
 * is minutes of CPU work that belongs in a queue worker with a timeout around
 * it, not inside a request.
 *
 * The model matters more than the wrapper. MDX-NET Inst_HQ is trained to split
 * vocals from everything else, which is exactly the cut a dub needs: the
 * "instrumental" stem is the music, ambience and effects that must survive, and
 * the "vocals" stem is the dialogue being replaced.
 */

/** Where the venv lives when installed as documented. */
const DEFAULT_BINARY = "/srv/arce-projects/arciin-separator/bin/audio-separator"

/**
 * The default model, chosen for what actually runs.
 *
 * A two-stem MDX model would be the faster answer — the dub needs exactly one
 * boundary, between speech and everything else, so splitting out drums and bass
 * is work it never uses. But MDX runs on onnxruntime, whose prebuilt kernels
 * assume AVX, and on a CPU without it the process dies with an illegal
 * instruction part-way through loading. Demucs runs on torch, which falls back.
 *
 * Override with `ARCIIN_AUDIO_SEPARATOR_MODEL` on hardware with AVX2, where
 * `UVR-MDX-NET-Inst_HQ_3.onnx` is considerably quicker for the same job.
 */
/**
 * Exported because the stem cache is keyed on it.
 *
 * A cache entry is only valid for the model that produced it, so the worker has
 * to name the same default this backend would pick. Two copies of the string
 * would eventually diverge and serve stems from the wrong model.
 */
export const DEFAULT_SEPARATOR_MODEL = "htdemucs.yaml"

const DEFAULT_MODEL = DEFAULT_SEPARATOR_MODEL

/**
 * Non-vocal stems a four-stem model produces.
 *
 * Demucs splits into vocals, drums, bass and other rather than emitting a
 * single instrumental, so the background has to be summed back together. Doing
 * that is cheap; noticing it is necessary — an earlier version looked only for
 * an "(Instrumental)" file and would have reported a successful separation as
 * having produced nothing.
 */
const BACKGROUND_STEMS = [/\(Drums\)/i, /\(Bass\)/i, /\(Other\)/i]

export type SeparatorBackendOptions = {
  /** Overridable so a GPU build or a different install can be pointed at. */
  binaryPath?: string
  modelFilename?: string
  /**
   * How long the separator may print nothing before it is treated as hung.
   *
   * Not a limit on how long separation may take. There used to be one — thirty
   * minutes — and it killed a real 11:51 video at chunk 39 of 122 after half an
   * hour of correct work, because on this CPU that file needed about ninety
   * minutes. A duration limit cannot distinguish slow from stuck, and here slow
   * is the normal case, so the guard watches for silence instead.
   */
  stallTimeoutMs?: number
}

export class AudioSeparatorBackend implements AudioSeparationBackend {
  readonly id = "python-audio-separator"

  private readonly binaryPath: string
  private readonly modelFilename: string
  private readonly stallTimeoutMs: number

  constructor(options: SeparatorBackendOptions = {}) {
    this.binaryPath =
      options.binaryPath ?? process.env.ARCIIN_AUDIO_SEPARATOR_BIN ?? DEFAULT_BINARY
    this.modelFilename =
      options.modelFilename ?? process.env.ARCIIN_AUDIO_SEPARATOR_MODEL ?? DEFAULT_MODEL
    this.stallTimeoutMs = options.stallTimeoutMs ?? DEFAULT_STALL_TIMEOUT_MS
  }

  /**
   * Checked before a dub is queued, not after.
   *
   * Discovering the separator is missing halfway through a job means the
   * reader waited for nothing, so availability is a precondition.
   */
  async isAvailable(): Promise<boolean> {
    try {
      await access(this.binaryPath)
      return true
    } catch {
      return false
    }
  }

  async separate(request: SeparationRequest): Promise<AudioStems> {
    request.onStage?.("Separating dialogue from background")

    /**
     * The separator's own progress, read as it works.
     *
     * Owned here rather than in the worker: the worker asked for two stems and
     * should not have to know that this particular backend happens to be a
     * Python program that draws tqdm bars on stderr.
     */
    const progress = new SeparatorProgressReader()
    await runStreaming(
      this.binaryPath,
      [
        request.inputPath,
        "--output_dir",
        request.workDir,
        "--model_filename",
        this.modelFilename,
        "--output_format",
        "WAV",
      ],
      {
        signal: request.signal,
        stallTimeoutMs: this.stallTimeoutMs,
        onOutput: (chunk) => {
          const reading = progress.push(chunk)
          if (reading) request.onProgress?.(reading)
        },
        onComplete: request.onDiagnostics,
      },
    )
    const remaining = progress.flush()
    if (remaining) request.onProgress?.(remaining)

    const produced = (await readdir(request.workDir)).filter((n) =>
      n.toLowerCase().endsWith(".wav"),
    )
    const find = (marker: RegExp) => {
      const hit = produced.find((name) => marker.test(name))
      return hit ? path.join(request.workDir, hit) : null
    }

    // The tool names stems by what they contain, with the model appended.
    const dialoguePath = find(/\(Vocals\)|_Vocals|^vocals/i)
    if (!dialoguePath) {
      throw new Error(
        `Separation produced no vocal stem in ${request.workDir}. Files: ${produced.join(", ") || "(none)"}`,
      )
    }

    // A two-stem model hands back the background directly.
    const instrumental = find(/\(Instrumental\)|_Instrumental|no_vocals/i)
    if (instrumental) {
      return { dialoguePath, backgroundPath: instrumental, strategy: "separated" }
    }

    // A four-stem model does not: everything that is not speech has to be
    // summed back into the world the dub plays over.
    const pieces = BACKGROUND_STEMS.map(find).filter((p): p is string => Boolean(p))
    if (pieces.length === 0) {
      throw new Error(
        `Separation produced no background stems in ${request.workDir}. Files: ${produced.join(", ")}`,
      )
    }

    request.onStage?.("Combining background stems")
    const backgroundPath = path.join(request.workDir, "background.wav")
    await run(
      "ffmpeg",
      [
        "-y",
        ...pieces.flatMap((p) => ["-i", p]),
        "-filter_complex",
        // normalize=0: summing the parts must reproduce the original level,
        // not average it down by the number of stems.
        `amix=inputs=${pieces.length}:normalize=0`,
        backgroundPath,
      ],
      { timeout: 10 * 60 * 1000, signal: request.signal, maxBuffer: 32 * 1024 * 1024 },
    )

    return { dialoguePath, backgroundPath, strategy: "separated" }
  }
}

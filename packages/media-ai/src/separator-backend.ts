import { execFile } from "node:child_process"
import { access, readdir } from "node:fs/promises"
import path from "node:path"
import { promisify } from "node:util"

import type {
  AudioSeparationBackend,
  AudioStems,
  SeparationRequest,
} from "./audio-separation"

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
 * A vocal/instrumental model, not a four-stem one.
 *
 * Splitting into drums and bass would be wasted work: the dub needs one
 * boundary, between speech and everything else.
 */
const DEFAULT_MODEL = "UVR-MDX-NET-Inst_HQ_3.onnx"

export type SeparatorBackendOptions = {
  /** Overridable so a GPU build or a different install can be pointed at. */
  binaryPath?: string
  modelFilename?: string
  /** Separation is slow on CPU; a job should not hang on it forever. */
  timeoutMs?: number
}

export class AudioSeparatorBackend implements AudioSeparationBackend {
  readonly id = "python-audio-separator"

  private readonly binaryPath: string
  private readonly modelFilename: string
  private readonly timeoutMs: number

  constructor(options: SeparatorBackendOptions = {}) {
    this.binaryPath =
      options.binaryPath ?? process.env.ARCIIN_AUDIO_SEPARATOR_BIN ?? DEFAULT_BINARY
    this.modelFilename =
      options.modelFilename ?? process.env.ARCIIN_AUDIO_SEPARATOR_MODEL ?? DEFAULT_MODEL
    this.timeoutMs = options.timeoutMs ?? 30 * 60 * 1000
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

    await run(
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
      { timeout: this.timeoutMs, signal: request.signal, maxBuffer: 32 * 1024 * 1024 },
    )

    const produced = await readdir(request.workDir)
    const find = (marker: RegExp) => {
      const hit = produced.find((name) => marker.test(name) && name.toLowerCase().endsWith(".wav"))
      return hit ? path.join(request.workDir, hit) : null
    }

    // The tool names stems by what they contain, with the model appended.
    const backgroundPath = find(/\(Instrumental\)|_Instrumental|no_vocals/i)
    const dialoguePath = find(/\(Vocals\)|_Vocals|^vocals/i)

    if (!backgroundPath || !dialoguePath) {
      throw new Error(
        `Separation produced no usable stems in ${request.workDir}. Files: ${produced.join(", ") || "(none)"}`,
      )
    }

    return { dialoguePath, backgroundPath, strategy: "separated" }
  }
}

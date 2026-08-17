/**
 * Splitting a soundtrack into dialogue and everything else.
 *
 * A dub replaces the words and keeps the world: the music, the room, the traffic
 * outside. That is only possible if the two can be pulled apart, and pulling
 * them apart is the one part of this pipeline that cannot be done with
 * arithmetic.
 *
 * Centre-channel cancellation is the obvious cheap trick and it does not work
 * here. Measured on Arciin's own fixture, the two channels correlate at 0.994 —
 * the audio is mono duplicated across a stereo pair, as screen recordings and
 * phone video almost always are. Subtracting one channel from the other removes
 * the dialogue and the music together and leaves about 11% residual noise. There
 * is no stereo information to exploit, so a spectrogram model is not a nicety.
 *
 * Hence this boundary. The dubbing pipeline asks for two stems and does not care
 * how they were produced, so the separator can be swapped — a heavier model, a
 * GPU, a different tool — without any of the mixing or timing code changing.
 */

export type AudioStems = {
  /** Speech only. Discarded for the dub, kept for diagnostics. */
  dialoguePath: string
  /** Music, ambience, effects — everything the dub must preserve. */
  backgroundPath: string
  /** How this was produced, recorded on the dub for honesty about quality. */
  strategy: SeparationStrategy
}

/**
 * How the background was obtained.
 *
 * Stored with the dub, because "we separated the stems" and "we could not, so
 * the original audio is gone" are very different products and a reader deserves
 * to know which one they have.
 */
export type SeparationStrategy =
  /** A real model produced a background stem. Music and ambience survive. */
  | "separated"
  /** No separator available: the original audio is replaced wholesale. */
  | "replaced"

export type SeparationRequest = {
  /** Local path to the audio to split. */
  inputPath: string
  /** Directory the backend may write stems into. */
  workDir: string
  onStage?: (stage: string) => void
  signal?: AbortSignal
}

export interface AudioSeparationBackend {
  readonly id: string
  /** Whether this backend can run here, checked before a job is queued. */
  isAvailable(): Promise<boolean>
  separate(request: SeparationRequest): Promise<AudioStems>
}

export class SeparationUnavailableError extends Error {
  constructor(message = "No audio separation backend is available.") {
    super(message)
    this.name = "SeparationUnavailableError"
  }
}

/**
 * The separator the pipeline talks to.
 *
 * Ordered by preference, first available wins. Deliberately *without* a
 * whole-audio-replacement fallback: preserving the original background is the
 * point of the feature, so a missing separator is an error that stops the job
 * and says so, rather than a silent downgrade that quietly destroys the music.
 */
export class AudioSeparationService {
  constructor(private readonly backends: AudioSeparationBackend[]) {}

  async resolveBackend(): Promise<AudioSeparationBackend | null> {
    for (const backend of this.backends) {
      if (await backend.isAvailable()) return backend
    }
    return null
  }

  /** True when a dub can actually preserve the background here. */
  async isAvailable(): Promise<boolean> {
    return (await this.resolveBackend()) !== null
  }

  async separate(request: SeparationRequest): Promise<AudioStems> {
    const backend = await this.resolveBackend()
    if (!backend) {
      throw new SeparationUnavailableError(
        "Audio dubbing needs a separator so the original music and ambience can be kept. " +
          "Install one (see docs/DUBBING.md) and try again.",
      )
    }
    request.onStage?.(`Separating dialogue (${backend.id})`)
    return backend.separate(request)
  }
}

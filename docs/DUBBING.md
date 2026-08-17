# AI Dubbing

Translated speech, in the original speakers' vocal character, over the original
music and ambience.

Three distinct objects, deliberately separate:

```txt
Transcript    what was said
Translation   what it says in another language
Dub           generated speech for that translation
```

Reading a translation never spends money on speech, and pressing play never
regenerates audio. Only **Generate** and **Regenerate** call the provider.

## Why a separator is required

A dub replaces the words and keeps the world — the music, the room tone, the
traffic outside. That is only possible if dialogue and background can be pulled
apart.

The cheap trick is centre-channel cancellation (`L − R`), and it does not work
on real material. Measured on Arciin's own fixture:

```txt
L/R correlation : 0.9938
side/mid ratio  : 0.108
```

The audio is mono duplicated across a stereo pair, as screen recordings and
phone video almost always are. Subtracting one channel from the other removes
the dialogue *and* the music together and leaves ~11% residual noise. There is
no stereo information to exploit, so a spectrogram model is not a nicety.

`AudioSeparationService` therefore has **no whole-audio-replacement fallback**.
A missing separator fails the job with an explanation rather than silently
producing a dub with the soundtrack destroyed — preserving the background is the
point of the feature, and a quiet downgrade would be worse than an error.

### Installing a separator

```bash
python3 -m venv /srv/arce-projects/arciin-separator
/srv/arce-projects/arciin-separator/bin/pip install torch torchvision \
  --index-url https://download.pytorch.org/whl/cpu
/srv/arce-projects/arciin-separator/bin/pip install audio-separator onnxruntime audioread
```

Install CPU torch **first, from PyTorch's own index**. `audio-separator[cpu]`
pulls CUDA wheels regardless of the extra — several gigabytes of `nvidia_*`
packages that are useless without a GPU, and the download failed part-way
through on this machine before finishing.

The backend is pluggable (`AudioSeparationBackend`), so a GPU build or another
tool can be substituted without touching the timing, mixing or TTS code.

### This machine cannot run the ONNX models

Measured, not assumed:

```txt
CPU:  Intel Celeron N5105 @ 2.00GHz
avx: NO   avx2: NO   avx512f: NO   fma: NO   sse4_2: yes
```

`onnxruntime`'s prebuilt kernels assume AVX. On this processor they execute an
illegal instruction and the process dies with SIGILL partway through loading a
model — so **MDX/UVR models cannot be used here at all**. It is a property of
the hardware, not a configuration problem.

Torch survives the same CPU (NNPACK disables itself and falls back), so
**Demucs models are the viable local option on non-AVX hardware**. They are
slower, which is why separation runs in the media worker rather than a request.

A machine with AVX2 should prefer the MDX models: they are considerably faster
for the same job.

### The torchvision shim

`onnx2torch` imports `torchvision` for non-max-suppression — an
object-detection operation that vocal separation never performs — and
torchvision's native ops fail to register on Python 3.14. The import, not the
functionality, is what blocks separation.

The backend therefore runs the separator with a minimal `torchvision` stub
ahead of it on `PYTHONPATH`. Nothing installed is modified, the stub raises if
anything ever genuinely calls a vision op, and it can be deleted the moment the
upstream wheels support the interpreter.

## Speech synthesis

```txt
Model   gemini-3.1-flash-tts-preview
Output  audio/l16 · 24 kHz · mono (raw PCM)
```

Verified against the live API; `gemini-2.5-flash-preview-tts` returned no audio
and is not used. The model name lives in `dub-prompt.ts` and nowhere else.

**The video is never uploaded to the TTS endpoint.** Gemini receives translated
text and performance instructions, and returns audio. The original footage and
the original soundtrack stay on the server.

### Direction is not dialogue

A model handed "Accent: preserve source" in the same breath as the line to speak
will sometimes read the label aloud. Spoken words are fenced inside explicit
markers, `spokenTextOf()` recovers exactly what was asked to be said, and a test
asserts no heading, label or marker can appear inside it.

### Provider limits the pipeline works around

- **Two speakers per multi-speaker request.** Three or more are generated in
  separate requests and assembled on the timeline — never dropped, never merged
  into another speaker's voice.
- **Long takes drift.** Chunks are bounded by spoken length and wall-clock span,
  and never mix speakers. Not one request per line either.

## Vocal character, not identity

A `VoiceProfile` describes qualities you would use to pick a voice from a
library: pitch, energy, pace, texture, and an optional *vocal age style* and
*presentation*. It is never a claim about anyone's real age, gender,
nationality or identity — Arciin cannot know those from an audio track, and
asserting them would be wrong.

Nor is this voice cloning. These are Gemini's prebuilt voices, matched
approximately. The UI says **match vocal character** for that reason.

When analysis is inconclusive, the match returns a neutral voice and reports low
confidence rather than guessing.

## Timing

The original recording owns the clock, and translations run longer — Spanish
perhaps 20% longer than English. The order of remedies matters:

1. ask for the right duration when generating (a duration, not a playback rate),
2. nudge with a bounded time-stretch, `0.85×–1.15×`,
3. flag the segment as **needs review**.

Step 3 is the important one: forcing 6 seconds of speech into a 3-second slot
produces something nobody can follow, and shipping that is worse than saying so.
Segments shorter than their slot are left alone — the gap plays original
background, which is what a pause sounds like.

## Staleness

A dub records the translation and transcript timestamps it was made from, plus a
fingerprint of every voice setting that would change the audio. Re-translating,
editing the transcript or changing a voice makes the existing audio no longer
match its text, and it is reported as outdated rather than played as current.

The fingerprint is order-independent, so regenerating with unchanged settings
reproduces the same dub rather than quietly picking a different voice.

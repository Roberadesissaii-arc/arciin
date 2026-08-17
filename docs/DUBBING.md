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
/srv/arce-projects/arciin-separator/bin/pip install audio-separator onnxruntime audioread "librosa<1.0"
```

`librosa<1.0` is not cosmetic. `audio-separator` calls
`librosa.get_duration(filename=...)`, and 1.0 renamed that argument — so with
the current release the model runs to completion and then dies while *writing*
the stems, after all the compute has been spent.

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

### Measured separation quality

Verified against ground truth rather than by ear: a fixture was built by mixing
the speech fixture with a synthetic music bed at a known level, so the music
that *should* come back is known exactly.

```txt
recovered background   -29.2 dB    ground-truth music   -28.9 dB
correlation, recovered background vs true music   +0.839
correlation, recovered vocals     vs true music   +0.053
```

The background returns at within 0.3 dB of the level it went in at, and the
vocal stem is nearly free of music. That is real separation.

It is **not** perfect, and the number says so: 0.839, not 1.0. Roughly a sixth
of the waveform is not recovered exactly, which is what spectrogram separation
costs — expect some smearing of music under speech. The test also used tonal
synthetic music, which is an easier case than a dense real mix.

`tests/fixtures/e2e-video-music-fixture.mp4` holds that fixture. The
speech-only fixture cannot demonstrate any of this: Demucs correctly routes
almost all of its energy to vocals and leaves the other stems near-silent,
because there is no background in it to preserve.

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

### The controls a reader gets

Three depths, because the audience is three audiences.

**Auto** shows what will happen in a sentence and offers nothing to adjust. Most
people want the recommendation, and twenty controls by default serve only the few
who do not.

**Simple** exposes the four things people actually reach for: voice presentation,
vocal age style, accent, emotion.

**Advanced** adds the exact voice, pitch guidance, energy, texture, pacing and
free-text director notes.

Every control is local state until **Generate** or **Regenerate** is pressed, so
browsing options costs nothing — asserted by counting the generate POST across a
run that touches every field. Auto sends no overrides at all, so backing out of a
choice really does back out of it.

Pacing reads Slow / Natural / Fast. Every dub is fitted to the original timing
regardless of this setting, so calling one option "match video timing" would
imply the other two are not fitted.

### Free text is a prompt boundary

Director notes, custom accents and custom emotions are the only fields a person
types by hand, and they land in the same prompt as the words to be spoken. All
three are stripped of the speech markers, collapsed to one line and length-capped
(`sanitizePromptText`); a description that sanitises to nothing falls back to its
default rather than directing the model at an empty string.

The API enumerates the override fields rather than accepting an open record, so
an unknown voice name or an arbitrary instruction fails at the boundary for
nothing, instead of inside a job that has already paid for separation.

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

## Playback

The dub plays as a **second audio element over an untouched video element**. That
is the whole design, and the reason is one behaviour: someone four seconds into a
video who switches to Spanish should hear Spanish from four seconds. Re-encoding,
swapping the video's source, or re-keying the element all throw the playhead back
to zero.

The video is muted while a dub plays, so the original dialogue is not audible
underneath the translated dialogue. Play, pause, seek and rate are mirrored on
the events that cause them, and a 1-second interval corrects drift only past
0.25s — re-seeking every tick produces an audible stutter loop, which is worse
than a few milliseconds nobody can hear.

### The acceptance test

`tests/e2e/video-dub-playback.spec.ts` is the gate. Everything cheaper than it
can pass while the feature is broken: a `200` from the audio route proves a file
is servable, not that a browser decoded it. So it reads the live `<video>` and
`<audio>` — `readyState`, `duration`, `currentTime`, `paused`, `muted` — through
a run that plays, seeks to 4s, switches to Spanish, plays on, pauses, seeks
again and switches back. Playback must never reach the generate endpoint, and
that is counted across the whole run.

Both dubbing specs were checked by breaking the implementation on purpose:

| Mutation | Failure |
| --- | --- |
| dub starts at `0` instead of the playhead | `dub started at 0.05 for a video at 5.45` |
| video element keyed on the audio source | `playhead moved on switch: 4 -> 0` |
| overrides dropped from the request | wiring assertion, `Received: undefined` |

A test that cannot fail is not evidence.

### Why the test dub is seeded

`scripts/e2e-seed.mjs` seeds a transcript, a Spanish translation and a READY dub
pointing at `tests/fixtures/e2e-dub-audio-fixture.m4a` — a committed ten-second
tone that steps pitch once a second, so a person opening it can hear where in the
timeline they are.

Synthesising it per run would mean waiting on separation at ~13x realtime and
paying to re-derive identical bytes, and none of the properties above depend on
the audio having come from a voice model. **Whether the speech itself is good is
a separate question**, answered by running the pipeline against the provider —
and ultimately by listening, which no test can do.

## Progress

### The separator was already saying it

The tool prints tqdm frames — `39/122` — the whole way through a separation.
Arciin buffered them with `execFile` and threw them away at the end, so a
ninety-minute job showed one unchanging line of text.

It now streams. The output is read as it arrives, parsed, and reported through
`onProgress` on the separation boundary — the separator owns this, because the
worker asked for two stems and should not have to know that this backend happens
to draw progress bars on stderr.

The parser depends on one thing: a `39/122` pair. Not a line, not the words
around it, because that text is the part most likely to change between separator
versions and a parser that breaks on a cosmetic upstream change is worse than one
that occasionally sees nothing — seeing nothing degrades to "no counter", which
the UI already handles. It tolerates carriage returns, ANSI colour, several
redraws in one chunk, interleaved log lines, and a pair split across a read
boundary. That last one matters: without it, `39/122` cut in half reads as
`9/122` and the bar jumps backwards.

Progress is not allowed to decrease within a phase, because the separator prints
a fresh `0/122` when it begins another pass and that reads as a crash.

### The timeout was the bug

A real 11:51 video failed at chunk 39 of 122 after twenty-nine minutes of
correct work. Not the separator — the **30-minute wall clock** in
`separator-backend.ts`. On this CPU that file needs about ninety minutes, and a
duration limit cannot distinguish slow from stuck; on hardware where slow is the
normal case it reliably kills the wrong one.

The guard is now inactivity. Fifteen minutes with no output at all means hung;
two hours of steady frames just means the file is long.

Two related things surfaced while fixing it:

- Killing the child alone left a grandchild holding the pipe, so `close` took
  the full duration of a stand-in `sleep 30` to fire. Demucs forks torch
  workers, so on the real box that means orphaned processes burning a CPU there
  is none to spare. The process now gets its own group, and the group is
  signalled.
- The result is taken from `exit` with a short grace period rather than waiting
  on `close`, which an orphan can defer indefinitely.

### What gets written down

`MediaDub` carries `progressPercent`, `progressCurrent`, `progressTotal` and
`progressUpdatedAt`. The numbers come only from whatever is doing the work —
the separator counts audio chunks, synthesis counts the chunks it planned before
it started — and a stage that cannot count leaves them null rather than
inventing a figure.

Writes are throttled on movement or elapsed time, whichever comes first. For the
real 122-chunk job that is under two writes a minute while still following every
chunk; for a fast stage reporting several times a second it collapses to a
handful. The elapsed-time rule exists for the timestamp rather than the number:
a bar frozen at 32% needs to prove it is being watched.

`progressUpdatedAt` is what makes a stall visible at all. After five minutes of
silence the panel says so — and does not call the job failed, because a slow
separation and a dead worker look identical from outside and only one of them
deserves an alarm.

### No estimates

A chunk takes between thirty-five and sixty seconds here and that variance is the
whole problem: an ETA built on it would be wrong by many minutes. Being told
"about 12 minutes left" for forty minutes is worse than being told nothing. The
UI shows what is true — the stage, the count, the percentage, when it last moved
— and nothing it would have to guess. There is no client-side timer anywhere;
the reload test exists to prove it, since a timer is exactly what would not
survive one.

## Failures

`MediaDub.error` used to hold whatever the tool threw, which for a separator
crash was four kilobytes of Python logging and tqdm redraws containing absolute
server paths — rendered directly into the panel, teaching the reader nothing.

Now `error` is a sentence naming the stage that failed, `errorDetail` is the
bounded sanitised output behind a disclosure, and the complete log goes to
`<storage>/logs/dub-<id>.log`. Sanitising collapses redraws to their last frame,
reduces absolute paths to filenames, keeps the end rather than the beginning
(the reason is always at the end), and caps at 4 KB.

`SIGKILL` is reported as what it almost always is on a 7 GB box running Demucs:
the kernel reclaiming memory. The panel says so and suggests a shorter video.

## Card state

A running dub is visible on the video card with the panel closed, and survives a
reload, a navigation, and a different browser — because the state is the
server's.

The obvious implementation is a status request per card, which for a library of
two hundred videos is two hundred requests to draw two hundred badges. Instead
the asset listing carries a compact summary assembled in three queries for the
whole page, and a test counts the per-card requests rather than trusting the
code to be right.

The shape is about activity rather than dubbing — kind, label, stage, progress —
so transcription and translation can join without redesigning the card.
Transcription already does.

Two states are kept apart. The thumbnail carries the transient one (running, or
failed) top-right; hovering names the operation and its progress, clicking opens
the panel directly on that dub. Under the title sits the permanent one —
"3 languages · Spanish" — which stays visible while another language generates.

**Language convention:** original plus translations. A Hindi video with English
and Arabic translations is *3 languages*, which is what a person would say out
loud about the file. A single dub is named rather than counted.

## Downloads

The dubbed **audio** is stored, and served with range support so seeking is not
a re-download.

The dubbed **video** is assembled on request instead of stored. A dubbed copy of
a 175 MB film is another 175 MB per language, which on a self-hosted box is a
real cost for a file most people fetch once; the video stream is copied rather
than re-encoded, so building it takes seconds against the hour the dub took. The
muxed file is written to temp, streamed, and removed when the response ends.

## Memory is the other limit on this box

A 12-minute video is not only slow to separate here, it is close to the memory
ceiling. Measured: `audio-separator` reached **2.28 GB RSS** on the 11:51 file,
on a machine with 7.1 GB total and swap already largely consumed. Running the
browser test suite at the same time was enough to push it over, and the kernel
killed the separator:

```txt
Out of memory: Killed process (audio-separator) anon-rss:2279824kB
```

Two things follow. Separation should not be run alongside anything else heavy on
this hardware. And a `SIGKILL` from the separator is reported as what it almost
always is here — the failure message says the system stopped it, most likely for
memory, and suggests a shorter video, because that is the actionable answer
rather than a stack trace.

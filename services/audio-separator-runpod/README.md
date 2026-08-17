# GPU audio separation worker (RunPod Serverless)

Separating a twelve-minute video on Arciin's own CPU takes about two and a half
hours. This runs the same `python-audio-separator` stack on a GPU so long media
becomes dubbable on modest self-hosted hardware.

## What it will not do

**It refuses to run on CPU.** A container named "gpu" proves nothing: if the
image, the host or the driver disagree, torch quietly falls back and the job
completes slowly while billing for a GPU. `require_gpu()` fails the job, and the
entrypoint fails the worker at startup, so an endpoint that cannot accelerate
does not sit in the pool advertising that it can.

**It never receives media over the wire.** The job payload carries keys into a
network volume:

```json
{ "job_id": "...", "input_key": "...", "output_prefix": "...", "model": "htdemucs.yaml" }
```

RunPod mounts the volume at `/runpod-volume`, so the audio is already local. A
12-minute WAV is ~125 MB; base64 in a JSON body would be enormous and slow.

## Contract

| Direction | Path on the volume |
| --- | --- |
| in | `<output_prefix>/../source.wav` (given as `input_key`) |
| out | `<output_prefix>/dialogue.wav` |
| out | `<output_prefix>/background.wav` |
| out | `<output_prefix>/result.json` |

Demucs emits four stems and has no single "instrumental"; drums, bass and other
are summed with `normalize=0` so the background returns at its original level
rather than a third of it. The raw four are deleted — nothing downstream wants
them.

Progress is reported through `runpod.serverless.progress_update` in the same
shape Arciin parses from the local separator, so one persistence path and one
estimate serve both:

```json
{ "stage": "separating", "current": 39, "total": 122, "percent": 32 }
```

A health probe (`{"op": "health"}`) answers **without** the GPU refusal, so the
connection test can tell "no GPU" from "endpoint unreachable" — very different
problems to fix.

## Build and deploy

```bash
docker build -t YOUR_REGISTRY/arciin-audio-separator:latest .
docker push YOUR_REGISTRY/arciin-audio-separator:latest
```

Then in RunPod:

1. Create a **Network Volume** in the datacenter you want to run in.
2. Create a **Serverless endpoint** from the image, and attach that volume.
3. Generate an **S3 API key** (Settings → S3 API keys). This is *not* the same
   credential as your RunPod API key — Arciin asks for both because they are
   different things.
4. Enter the API key, endpoint ID, volume ID, datacenter and S3 credentials in
   Arciin under Settings → Audio Separation.

The model is baked into the image at `/models`. Fetching it on first request
would turn the first job of the day into a much slower one, and RunPod bills for
that time.

## Tests

```bash
python3 -m pytest tests/ -q
```

Runs without a GPU, RunPod or the separator binary. They cover the decisions —
the CPU refusal, progress parsing against real tqdm output, and four stems
becoming two — not the arithmetic. That a GPU is genuinely used is verified at
runtime by the handler and by Arciin's connection test, which is the only place
it can honestly be checked.

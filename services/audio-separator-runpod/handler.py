"""RunPod Serverless handler for GPU audio separation.

This exists for one reason: separating a twelve-minute video on Arciin's own
CPU takes about two and a half hours, which makes dubbing long media
impractical on modest self-hosted hardware. The same `python-audio-separator`
stack on a GPU should take a small fraction of that.

Two rules shape the whole file.

**It never touches media over the wire.** The job payload carries keys into a
network volume, not audio. A 12-minute WAV is 125 MB; base64 in a JSON body
would be both enormous and slow, and RunPod mounts the volume at
`/runpod-volume` inside the worker anyway, so the bytes are already local by
the time this runs.

**It refuses to run on CPU.** A container named "gpu" proves nothing. If CUDA
is unavailable this fails loudly at startup rather than quietly performing the
exact slow separation the feature exists to escape — a silent CPU fallback here
would look like success and cost money for no speed-up at all.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

import runpod

# RunPod mounts the network volume here for Serverless workers.
VOLUME_ROOT = Path(os.environ.get("ARCIIN_VOLUME_ROOT", "/runpod-volume"))

# Matched locally too: changing hardware and model at once would make a
# speed-up impossible to attribute.
DEFAULT_MODEL = os.environ.get("ARCIIN_SEPARATOR_MODEL", "htdemucs.yaml")

# tqdm writes for a terminal, not a parser: carriage returns, block characters,
# several redraws per write. The pair is the only dependable part.
PROGRESS_PAIR = re.compile(r"(?<![\d.,])(\d{1,7})\s*/\s*(\d{1,7})(?![.,]?\d)")

# Demucs splits into four; everything that is not speech is the world the dub
# plays over, so the last three are summed back together.
BACKGROUND_MARKERS = ("(Drums)", "(Bass)", "(Other)")
VOCAL_MARKERS = ("(Vocals)",)


class GpuUnavailable(RuntimeError):
    """Raised when the worker cannot do the one thing it is for."""


def separator_report() -> dict[str, Any]:
    """What this worker actually runs, read rather than assumed.

    The stem cache is keyed on these values, so reporting a pinned constant
    instead of the installed reality would let a drifted image serve stems under
    a fingerprint that does not describe them.
    """
    report = {"implementation": "python-audio-separator", "version": "unknown", "pinned": None}
    report["pinned"] = os.environ.get("ARCIIN_SEPARATOR_VERSION")
    try:
        output = subprocess.run(
            ["audio-separator", "--version"], capture_output=True, text=True, timeout=30
        ).stdout
        match = re.search(r"\d+\.\d+\.\d+", output)
        if match:
            report["version"] = match.group(0)
    except Exception as error:  # pragma: no cover - environment dependent
        report["error"] = str(error)

    # A mismatch is worth surfacing: it means the image drifted from its pin and
    # its results should not share a cache with the version it claims.
    if report["pinned"] and report["version"] not in ("unknown", report["pinned"]):
        report["drift"] = f"pinned {report['pinned']} but running {report['version']}"
    return report


def gpu_report() -> dict[str, Any]:
    """What this worker can actually do, checked rather than assumed."""
    report: dict[str, Any] = {
        "cuda_available": False,
        "device": "cpu",
        "gpu_name": None,
        "cuda_version": None,
        "torch_version": None,
    }
    try:
        import torch

        report["torch_version"] = torch.__version__
        report["cuda_available"] = bool(torch.cuda.is_available())
        if report["cuda_available"]:
            report["device"] = "cuda"
            report["gpu_name"] = torch.cuda.get_device_name(0)
            report["cuda_version"] = torch.version.cuda
    except Exception as error:  # pragma: no cover - import failure path
        report["error"] = str(error)
    return report


def require_gpu() -> dict[str, Any]:
    """Fail loudly rather than separate on CPU.

    Silently falling back would produce a correct dub, slowly, while billing for
    a GPU — the worst of both options and invisible from the outside.
    """
    report = gpu_report()
    if not report["cuda_available"]:
        raise GpuUnavailable(
            "CUDA is not available in this worker, so separation would run on CPU. "
            "Refusing: this endpoint exists to provide GPU acceleration. "
            f"torch={report.get('torch_version')} error={report.get('error')}"
        )
    return report


def parse_progress(chunk: str) -> tuple[int, int] | None:
    """The last defensible `39/122` in a chunk of separator output.

    The last rather than the first: one write often contains several redraws and
    the newest is the current state. Guards reject the pair-shaped things that
    sit next to real progress — a rate like `44.74s/it`, a version, a ratio of
    one.
    """
    text = chunk.replace("\r", "\n")
    found = None
    for match in PROGRESS_PAIR.finditer(text):
        completed, total = int(match.group(1)), int(match.group(2))
        if total < 2 or completed > total:
            continue
        found = (completed, total)
    return found


def run_separator(source: Path, out_dir: Path, model: str, on_progress) -> None:
    """Run the separator, reporting progress as it goes.

    Streamed rather than buffered so the caller can emit progress while the work
    is happening; a promise that resolves at the end cannot report anything.
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    command = [
        "audio-separator",
        str(source),
        "--output_dir",
        str(out_dir),
        "--model_filename",
        model,
        "--output_format",
        "WAV",
    ]

    process = subprocess.Popen(
        command,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    tail: list[str] = []
    assert process.stdout is not None
    for line in process.stdout:
        tail.append(line)
        # Bounded: a long separation prints megabytes of redraws, and only the
        # end of it is useful when something goes wrong.
        if len(tail) > 400:
            del tail[:200]
        reading = parse_progress(line)
        if reading:
            on_progress(reading[0], reading[1])

    code = process.wait()
    if code != 0:
        raise RuntimeError(
            f"audio-separator exited with code {code}: {''.join(tail[-40:])[-2000:]}"
        )


def find_stem(produced: list[Path], markers: tuple[str, ...]) -> Path | None:
    for path in produced:
        if any(marker.lower() in path.name.lower() for marker in markers):
            return path
    return None


def build_background(produced: list[Path], out_dir: Path) -> Path:
    """Sum drums, bass and other back into one background track.

    Demucs has no single "instrumental" output, and the dub needs exactly one
    boundary — speech against everything else. `normalize=0` so summing the
    parts reproduces the original level instead of averaging it down by the
    number of stems.
    """
    pieces = [p for p in produced if any(m.lower() in p.name.lower() for m in BACKGROUND_MARKERS)]
    if not pieces:
        raise RuntimeError(f"no background stems produced: {[p.name for p in produced]}")

    background = out_dir / "background.wav"
    args: list[str] = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error"]
    for piece in pieces:
        args += ["-i", str(piece)]
    args += [
        "-filter_complex",
        f"amix=inputs={len(pieces)}:normalize=0",
        str(background),
    ]
    subprocess.run(args, check=True)
    return background


def handler(job: dict[str, Any]) -> dict[str, Any]:
    """Separate one file that is already on the shared volume.

    Input carries keys, never bytes:

        {"job_id": ..., "input_key": ..., "output_prefix": ..., "model": ...}
    """
    started = time.time()
    payload = job.get("input") or {}

    if payload.get("op") == "health":
        # Used by the connection test: proves the endpoint runs, and on what.
        return {
            "ok": True,
            "gpu": gpu_report(),
            "separator": separator_report(),
            "model": payload.get("model", DEFAULT_MODEL),
            "volume_mounted": VOLUME_ROOT.exists(),
            "separator_available": shutil.which("audio-separator") is not None,
        }

    gpu = require_gpu()

    input_key = payload.get("input_key")
    output_prefix = payload.get("output_prefix")
    model = payload.get("model") or DEFAULT_MODEL
    if not input_key or not output_prefix:
        raise ValueError("input_key and output_prefix are required")

    source = VOLUME_ROOT / input_key
    if not source.exists():
        raise FileNotFoundError(
            f"source audio not found on the network volume at {input_key}. "
            "Check that the endpoint has the right volume attached."
        )

    out_dir = VOLUME_ROOT / output_prefix
    work_dir = out_dir / "raw"

    def on_progress(completed: int, total: int) -> None:
        # The same shape Arciin parses from the local separator, so one
        # persistence path and one estimate serve both.
        runpod.serverless.progress_update(
            job,
            json.dumps(
                {
                    "stage": "separating",
                    "current": completed,
                    "total": total,
                    "percent": round(completed / total * 100) if total else 0,
                }
            ),
        )

    separation_started = time.time()
    run_separator(source, work_dir, model, on_progress)
    separation_seconds = time.time() - separation_started

    produced = sorted(work_dir.glob("*.wav"))
    dialogue = find_stem(produced, VOCAL_MARKERS)
    if dialogue is None:
        raise RuntimeError(f"no vocal stem produced: {[p.name for p in produced]}")

    background = build_background(produced, out_dir)
    final_dialogue = out_dir / "dialogue.wav"
    shutil.move(str(dialogue), str(final_dialogue))

    # The raw four are large and nobody downstream wants them.
    shutil.rmtree(work_dir, ignore_errors=True)

    result = {
        "ok": True,
        "separator": separator_report(),
        "dialogue_key": f"{output_prefix}/dialogue.wav",
        "background_key": f"{output_prefix}/background.wav",
        "model": model,
        "gpu": gpu,
        "separation_seconds": round(separation_seconds, 2),
        "total_seconds": round(time.time() - started, 2),
        "dialogue_bytes": final_dialogue.stat().st_size,
        "background_bytes": background.stat().st_size,
    }

    (out_dir / "result.json").write_text(json.dumps(result, indent=2))
    return result


if __name__ == "__main__":
    # Checked once at startup as well as per job: a worker that cannot do the
    # job should not sit in the pool advertising that it can.
    try:
        report = require_gpu()
        print(f"[arciin] GPU ready: {report['gpu_name']} (CUDA {report['cuda_version']})")
    except GpuUnavailable as error:
        print(f"[arciin] FATAL: {error}", file=sys.stderr)
        raise

    runpod.serverless.start({"handler": handler})

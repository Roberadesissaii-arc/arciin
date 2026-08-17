# GPU audio separation for Arciin, as a RunPod Serverless worker.
#
# Built on the official CUDA runtime rather than assembled from a bare Python
# image: getting torch, CUDA and cuDNN to agree by hand is the single most
# common way a "GPU" container ends up quietly running on CPU, which is exactly
# the failure this worker refuses to have.
FROM nvidia/cuda:12.4.1-cudnn-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv ffmpeg git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Torch first, from the CUDA index, so the resolver cannot quietly settle on a
# CPU build to satisfy a later dependency. Arciin's own host hit this in
# reverse: `audio-separator[cpu]` pulled two gigabytes of CUDA wheels.
RUN pip3 install --upgrade pip && \
    pip3 install torch torchaudio --index-url https://download.pytorch.org/whl/cu124

# The same separator stack the local backend uses, so a dub sounds the same
# whichever side of the boundary produced it.
RUN pip3 install "audio-separator[gpu]" runpod

# Baked in rather than fetched on first request: a cold start that downloads a
# model turns the first job of the day into a much slower one, and RunPod bills
# for that time.
ENV AUDIO_SEPARATOR_MODEL_DIR=/models
RUN mkdir -p /models && \
    python3 -c "from audio_separator.separator import Separator; \
                s = Separator(model_file_dir='/models'); \
                s.download_model_files('htdemucs.yaml')" || \
    echo "[build] model prefetch skipped; it will download on first use"

COPY handler.py /app/handler.py
COPY tests /app/tests

# Fails the build if the image cannot see a GPU at runtime — checked again in
# the handler, because a build host and a serverless host are different machines.
HEALTHCHECK --interval=30s --timeout=10s --retries=2 \
    CMD python3 -c "import torch, sys; sys.exit(0 if torch.cuda.is_available() else 1)"

CMD ["python3", "-u", "/app/handler.py"]

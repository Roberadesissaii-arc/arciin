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

# Pinned, all of it.
#
# The stem cache is keyed on the separator's implementation and version, so
# local and cloud results are only interchangeable while both run the same
# build. A floating `latest` would silently change the fingerprint on some
# future rebuild: every cached separation would miss, every language would pay
# again, and it would look like a cache bug rather than a dependency drift.
#
# ARCIIN_SEPARATOR_VERSION must match what this server runs — check with
# `audio-separator --version` locally before changing it. Upgrading on purpose
# is fine and simply invalidates the cache, which is the correct outcome.
ARG ARCIIN_SEPARATOR_VERSION=0.44.5
ARG ARCIIN_TORCH_VERSION=2.13.0
ARG ARCIIN_RUNPOD_SDK_VERSION=1.7.7

# Torch first, from the CUDA index, so the resolver cannot quietly settle on a
# CPU build to satisfy a later dependency. Arciin's own host hit this in
# reverse: `audio-separator[cpu]` pulled two gigabytes of CUDA wheels.
RUN pip3 install --upgrade pip && \
    pip3 install "torch==${ARCIIN_TORCH_VERSION}" torchaudio \
        --index-url https://download.pytorch.org/whl/cu124

# The same separator stack, at the same version, as the local backend.
RUN pip3 install \
        "audio-separator[gpu]==${ARCIIN_SEPARATOR_VERSION}" \
        "runpod==${ARCIIN_RUNPOD_SDK_VERSION}"

# Fail the build rather than ship an image whose fingerprint would lie.
RUN installed=$(pip3 show audio-separator | awk '/^Version:/{print $2}') && \
    if [ "$installed" != "${ARCIIN_SEPARATOR_VERSION}" ]; then \
        echo "separator version drift: wanted ${ARCIIN_SEPARATOR_VERSION}, got $installed" >&2; \
        exit 1; \
    fi && \
    echo "[build] separator pinned at $installed"

ENV ARCIIN_SEPARATOR_VERSION=${ARCIIN_SEPARATOR_VERSION}

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

# Build argument to control image variant (full or slim)
ARG VARIANT=full

FROM python:3.11-slim AS builder

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY README.md ./
COPY requirements.txt ./
COPY ttsfm/ ./ttsfm/

ARG VERSION=0.0.0
ENV SETUPTOOLS_SCM_PRETEND_VERSION=${VERSION}

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir --prefix /install .[web] \
    && find /install -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true \
    && find /install -type f -name '*.pyc' -delete \
    && find /install -type f -name '*.pyo' -delete \
    && find /install -type d -name 'tests' -exec rm -rf {} + 2>/dev/null || true \
    && find /install -type d -name 'test' -exec rm -rf {} + 2>/dev/null || true \
    && find /install -name '*.dist-info' -type d -exec sh -c 'rm -f "$1"/RECORD "$1"/INSTALLER' sh {} \; 2>/dev/null || true

FROM python:3.11-slim

# Re-declare ARG after FROM to make it available in this stage
ARG VARIANT=full

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000 \
    TTSFM_VARIANT=${VARIANT}

WORKDIR /app

# Conditional ffmpeg installation based on variant
# Full variant: includes ffmpeg for MP3 combining, speed adjustment, and format conversion
# Slim variant: minimal image without ffmpeg (WAV-only auto-combine, no speed adjustment)
RUN apt-get update \
    && if [ "$VARIANT" = "full" ]; then \
         apt-get install -y --no-install-recommends ffmpeg; \
       fi \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin ttsfm

COPY --from=builder /install /usr/local
ENV PATH="/usr/local/bin:$PATH"

COPY --chown=ttsfm:ttsfm ttsfm-web/ ./ttsfm-web/

USER ttsfm

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health', timeout=5)"]

WORKDIR /app/ttsfm-web
CMD ["python", "run.py"]

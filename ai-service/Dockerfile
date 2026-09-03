# syntax=docker/dockerfile:1
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Whether to install the layout→graph pipeline (OpenCV, scikit-image, RapidOCR).
#
# Build with --build-arg WITH_LAYOUT=false for a much smaller image that still serves /analyze;
# /layout/* then reports layout.available=false at /health and the UI says AI tracing is
# unavailable, which is the documented degradation rather than a broken service.
ARG WITH_LAYOUT=true

# Whether to install label reading (rapidocr, and with it the ONNX runtime).
#
# Off by default because it roughly doubles resident memory and will not fit a 512MB
# instance alongside OpenCV and scikit-image. Without it the pipeline still traces a
# plan from its geometry; it just cannot read the words printed on it. Turn it on
# where there is room: --build-arg WITH_OCR=true.
# Off, and this time measured rather than assumed.
#
# With it installed the service starts fine and reports layout.available=true, then a
# single /layout/parse kills the container: the request returns 503 in under a second, the
# instance restarts, and the caller sits on "Reading the plan..." forever because the
# process handling it is gone. RapidOCR loads its detection and recognition models on
# first use, and that on top of OpenCV and scikit-image does not fit 512MB.
#
# The earlier libxcb failure was a separate, real bug and its fix stays: those system
# libraries are needed whenever opencv-python is present, and turning this arg on is now
# a supported thing to do on an instance with room for it.
#
# Tracing survives without OCR. Naming does not: zones come back unnamed rather than
# labelled from the words printed on the plan.
ARG WITH_OCR=false

# System libraries the vision stack links against. Every one of these fails at RUNTIME,
# not at build, so the image looks healthy until a plan is uploaded.
#
#   libglib2.0-0                       opencv-python-headless
#   libxcb1, libgl1, libsm6, libxext6  rapidocr-onnxruntime depends on full
#                                      opencv-python, not the headless build, and
#                                      that links X11 and OpenGL even though nothing
#                                      here ever opens a window.
#
# Their absence surfaces as "ImportError: libxcb.so.1: cannot open shared object file"
# and the whole layout pipeline reporting itself unavailable. This is what actually
# broke this service's first deploy; it was read as the 512MB memory limit and OCR
# was removed to compensate, which fixed the symptom by deleting the feature.
#
# curl is here for HEALTHCHECK; slim ships none of it.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      libglib2.0-0 libxcb1 libgl1 libsm6 libxext6 curl \
 && rm -rf /var/lib/apt/lists/*

# Requirements before source, so editing app/ does not reinstall the dependency tree.
COPY requirements.txt requirements-layout.txt requirements-ocr.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
 && if [ "$WITH_LAYOUT" = "true" ]; then pip install --no-cache-dir -r requirements-layout.txt; fi \
 && if [ "$WITH_OCR" = "true" ]; then pip install --no-cache-dir -r requirements-ocr.txt; fi

COPY app ./app

RUN useradd --create-home --uid 1001 concourse && chown -R concourse:concourse /app
USER concourse

EXPOSE 8000

HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

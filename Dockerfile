# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
# The builder is a small Python service with no third-party runtime dependencies.
FROM docker.io/library/python:3.12-slim

LABEL org.opencontainers.image.title="RadioFoundry CP Builder" \
      org.opencontainers.image.description="Location-aware codeplug builder for RadioFoundry radios" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.source="https://github.com/ea7klk/RadioFoundry-cp-builder"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    CPB_HOST=0.0.0.0 \
    CPB_PORT=8080 \
    CPB_CACHE_DIR=/var/cache/cp-builder

WORKDIR /app
COPY server ./server
COPY web ./web

RUN useradd --create-home --uid 10001 builder \
 && mkdir -p "$CPB_CACHE_DIR" \
 && chown -R builder:builder "$CPB_CACHE_DIR"
USER builder

VOLUME ["/var/cache/cp-builder"]
EXPOSE 8080

HEALTHCHECK --interval=60s --timeout=5s --start-period=5s --retries=3 \
  CMD python3 -c "import urllib.request;urllib.request.urlopen('http://127.0.0.1:8080/api/health',timeout=4)"

CMD ["python3", "-m", "server"]

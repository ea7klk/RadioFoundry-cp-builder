# SPDX-License-Identifier: MIT
# Copyright (c) 2026 The RadioFoundry-cp-builder Authors
# Run, test and container targets. Python 3.11+ and Node 20+ (tests only).

PY ?= python3
PORT ?= 8080
CACHE ?= var/cache
VENV ?= .venv
IMAGE ?= radiofoundry-cp-builder

.PHONY: help run serve test test-py test-js lint docker docker-run clean

help:
	@echo "make run        build the site and serve it on http://localhost:$(PORT)/"
	@echo "make test       run the Python and JavaScript tests"
	@echo "make docker     build the container image ($(IMAGE))"
	@echo "make docker-run run the image on port $(PORT) with a cache volume"
	@echo "make clean      remove caches and build output"

run serve:
	$(PY) -m server --host 127.0.0.1 --port $(PORT) --cache-dir $(CACHE)

test: test-py test-js

test-py:
	$(PY) -m pytest -q

test-js:
	node --test "tests/*.test.mjs"

lint:
	$(PY) -m compileall -q server tests
	node --check web/js/app.js
	node --check web/js/build.js

docker:
	docker build -t $(IMAGE):latest .

docker-run:
	docker run --rm -p $(PORT):8080 -v cpb-cache:/var/cache $(IMAGE):latest

clean:
	rm -rf var/cache __pycache__ server/__pycache__ tests/__pycache__ .pytest_cache

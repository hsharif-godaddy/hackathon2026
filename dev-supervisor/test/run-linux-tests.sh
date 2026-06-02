#!/usr/bin/env bash
# Full dev-supervisor suite, CI parity. Runs inside the Linux test image
# (test/Dockerfile.linux) via `make test-linux`. Mirrors the jobs in
# .github/workflows/dev-supervisor.yml — lint, lint-rust, test, test-rust,
# integration (subproc) — plus the strangler harness, which only runs on Linux.
# The Docker-in-Docker integration test is intentionally excluded; run it on the
# host with `make test-docker`.
#
# Every stage runs even if an earlier one fails, then a summary prints and the
# script exits non-zero if any stage failed.
set -u

fail=0
results=""

stage() {
  name="$1"
  shift
  echo ""
  echo "==================== ${name} ===================="
  if "$@"; then
    results="${results}"$'\n'"  PASS  ${name}"
  else
    results="${results}"$'\n'"  FAIL  ${name}"
    fail=1
  fi
}

# gofmt exit code only reports invocation errors (parse failure, missing binary),
# never "files need formatting" — that's signalled via stdout. So check both:
# a non-zero exit is a hard failure, and any listed file is an unformatted failure.
# Without the exit check, a gofmt crash captures empty stdout and mislabels as PASS.
gofmt_check() {
  out=$(gofmt -s -l .) || { echo "gofmt failed to run: $out"; return 1; }
  [ -z "$out" ] || { echo "unformatted:"; echo "$out"; return 1; }
}

# Surface the resolved toolchain versions up front: if the image has drifted from
# the versions CI pins, it shows here rather than as a confusing downstream failure.
toolchains() {
  go version && rustc --version && cargo --version && golangci-lint version
}

stage "toolchains"               toolchains
stage "gofmt"                    gofmt_check
stage "go mod verify"            go mod verify
stage "go vet"                   go vet ./...
stage "golangci-lint"            golangci-lint run --timeout=5m ./...
stage "go test -race"            go test -race ./...
stage "cargo fmt"                sh -eu -c 'cd rust && cargo fmt --all -- --check'
stage "cargo clippy"             sh -eu -c 'cd rust && cargo clippy --workspace --all-targets -- -D warnings'
stage "cargo test"               sh -eu -c 'cd rust && cargo test'
stage "integration (subproc)"    make test-integration-subproc
stage "integration (strangler)"  make test-integration-strangler

echo ""
echo "==================== summary ===================="
printf '%s\n' "${results}"
echo ""
if [ "${fail}" -eq 0 ]; then
  echo "ALL LINUX CHECKS PASSED"
else
  echo "SOME LINUX CHECKS FAILED"
fi
exit "${fail}"

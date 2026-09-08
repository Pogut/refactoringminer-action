#!/usr/bin/env bash
#
# Run the RefactoringMiner action locally against a local Docker image.
#
# It reproduces the GitHub Actions runtime (env vars + event payload + a `docker`
# that doesn't try to pull) and invokes the compiled export/comment steps at
# dist/export/index.js and dist/comment/index.js, so the real exporter.js /
# formatter.js code paths execute. It does NOT exercise the actual GitHub
# Pages bundle/deploy (scripts/bundle-site.sh + actions/deploy-pages) since
# those need the real Actions runtime — its artifact store and OIDC token —
# so mode=pages just stops after export.js and reports what would have been
# bundled and deployed.
#
# Usage:
#   ./run-local.sh                # push/commit-analysis path (default)
#   EVENT=pull_request ./run-local.sh
#
# Override anything via env, e.g.:
#   IMAGE=testimage:latest WORKSPACE=/path/to/java-repo SHA=<commit> ./run-local.sh
#
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ACTION_ROOT="$(cd "$HERE/../.." && pwd)"

# ---------------------------------------------------------------------------
# Config — override by exporting these before running.
# ---------------------------------------------------------------------------
EVENT="${EVENT:-push}"                                   # push | pull_request
IMAGE="${IMAGE:-testimage:latest}"                       # your local image
WORKSPACE="${WORKSPACE:-/Users/parsahejazi/Documents/GH repos/RefactoringMiner}"
ENABLE_WEB_VIEW="${ENABLE_WEB_VIEW:-false}"              # true exercises exporter.js (pull_request only)
GITHUB_TOKEN="${GITHUB_TOKEN:-dummy-local-token}"        # real token only needed to actually post a PR comment
REPOSITORY="${REPOSITORY:-tsantalis/RefactoringMiner}"

# ---------------------------------------------------------------------------
# Sanity checks.
# ---------------------------------------------------------------------------
if ! /usr/local/bin/docker info >/dev/null 2>&1; then
  echo "ERROR: Docker daemon not reachable. Start Docker Desktop first (e.g. 'open -a Docker')." >&2
  exit 1
fi
if ! /usr/local/bin/docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "ERROR: local image '$IMAGE' not found. Build/load it, or set IMAGE=<tag>." >&2
  echo "       Available images:" >&2
  /usr/local/bin/docker images >&2
  exit 1
fi
if [ ! -d "$WORKSPACE/.git" ]; then
  echo "ERROR: WORKSPACE '$WORKSPACE' is not a git repo." >&2
  exit 1
fi

# Resolve commit SHAs from the workspace repo.
SHA="${SHA:-$(git -C "$WORKSPACE" rev-parse HEAD)}"
BASE_SHA="${BASE_SHA:-$(git -C "$WORKSPACE" rev-parse HEAD~1)}"

# ---------------------------------------------------------------------------
# Build the event payload.
# ---------------------------------------------------------------------------
if [ "$EVENT" = "pull_request" ]; then
  EVENT_PATH="$HERE/event-pr.generated.json"
  cat > "$EVENT_PATH" <<JSON
{
  "action": "synchronize",
  "pull_request": {
    "number": 1,
    "html_url": "https://github.com/${REPOSITORY}/pull/1",
    "base": { "sha": "${BASE_SHA}" },
    "head": { "sha": "${SHA}" }
  },
  "repository": { "private": false }
}
JSON
else
  EVENT_PATH="$HERE/event-push.json"
fi

echo "=== Local action run ==================================================="
echo "  event      : $EVENT"
echo "  image      : $IMAGE"
echo "  workspace  : $WORKSPACE"
echo "  base..head : ${BASE_SHA:0:9}..${SHA:0:9}"
echo "  web-view   : $ENABLE_WEB_VIEW"
echo "  event file : $EVENT_PATH"
echo "========================================================================"

# ---------------------------------------------------------------------------
# Phase 1: export.js. `core.setOutput` appends `name=value` lines to
# $GITHUB_OUTPUT, same as the real runtime, so we point it at a scratch file
# and parse it back out below instead of hand-parsing the deprecated
# `::set-output::` stdout format.
# ---------------------------------------------------------------------------
OUTPUT_FILE="$(mktemp)"
trap 'rm -f "$OUTPUT_FILE"' EXIT

env \
  PATH="$HERE/shim:$PATH" \
  GITHUB_TOKEN="$GITHUB_TOKEN" \
  RM_IMAGE="$IMAGE" \
  ENABLE_WEB_VIEW="$ENABLE_WEB_VIEW" \
  GITHUB_EVENT_NAME="$EVENT" \
  GITHUB_EVENT_PATH="$EVENT_PATH" \
  GITHUB_WORKSPACE="$WORKSPACE" \
  GITHUB_REPOSITORY="$REPOSITORY" \
  GITHUB_SHA="$SHA" \
  GITHUB_SERVER_URL="https://github.com" \
  GITHUB_RUN_ID="000000" \
  GITHUB_OUTPUT="$OUTPUT_FILE" \
  node "$ACTION_ROOT/dist/export/index.js"

MODE="$(sed -n 's/^mode=//p' "$OUTPUT_FILE")"
WEB_DIR="$(sed -n 's/^web-dir=//p' "$OUTPUT_FILE")"
VIEW_URL="$(sed -n 's/^view-url=//p' "$OUTPUT_FILE")"
REFACTORINGS_PATH="$(sed -n 's/^refactorings-path=//p' "$OUTPUT_FILE")"

echo "--- export.js result ---"
echo "  mode              : $MODE"
[ -n "$WEB_DIR" ] && echo "  web-dir           : $WEB_DIR (would be bundled into the multi-PR site and deployed via actions/deploy-pages in real CI)"
[ -n "$VIEW_URL" ] && echo "  view-url          : $VIEW_URL"
echo "------------------------"

if [ "$MODE" = "skip" ] || [ "$MODE" = "log" ] || [ "$MODE" = "remove" ]; then
  exit 0
fi

# ---------------------------------------------------------------------------
# Phase 2: comment.js. Real CI only reaches this after the Pages-deploy steps;
# locally we just pass through whatever export.js already resolved.
# ---------------------------------------------------------------------------
exec env \
  GITHUB_TOKEN="$GITHUB_TOKEN" \
  GITHUB_EVENT_PATH="$EVENT_PATH" \
  GITHUB_REPOSITORY="$REPOSITORY" \
  MODE="$MODE" \
  REFACTORINGS_PATH="$REFACTORINGS_PATH" \
  VIEW_URL="$VIEW_URL" \
  DEPLOY_OUTCOME="success" \
  node "$ACTION_ROOT/dist/comment/index.js"

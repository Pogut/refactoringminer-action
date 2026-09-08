#!/usr/bin/env bash
#
# Rebuilds the full multi-PR Pages site for this run and hands it to the deploy
# steps as a single tar. GitHub's Actions-based Pages deploy replaces the whole
# site every run, so to keep every PR's view alive we reconstruct
# "previous runs + this PR":
#
#   1. Restore the previously published site from the newest `pages-store`
#      artifact — our own long-retention copy, carried as one `site.tar`. (The
#      `github-pages` artifact the deploy consumes is pruned after ~a day, too
#      short to carry state between PRs.)
#   2. MODE=pages:  drop this PR's freshly exported view under
#                   refactorings/pr-<n>/, overwriting only that folder.
#      MODE=remove: delete refactorings/pr-<n>/ (the PR closed). Nothing to
#                   delete means nothing to deploy, and `deploy=false` is set.
#   3. Regenerate the site's root index.html listing every PR still published.
#   4. Tar the site. The same file is uploaded twice by the action: once as
#      `github-pages` for actions/deploy-pages, once as `pages-store` for the
#      next run to start from.
#
# Outputs (via $GITHUB_OUTPUT): site-dir, deploy-tar, store-tar, pr-number, deploy.
#
# Requires on the runner: gh (authenticated via GH_TOKEN), jq, tar, unzip — all
# present on ubuntu-latest. Requires the `actions: read` permission to list and
# download the prior artifact, and a workflow `concurrency:` group so two PRs'
# runs can't interleave restore → deploy → persist and lose each other's folder.
set -euo pipefail

MODE="${MODE:?MODE must be 'pages' or 'remove'}"
STORE_NAME="${STORE_NAME:-pages-store}"

PR="$(jq -r '.pull_request.number' "$GITHUB_EVENT_PATH")"
if [ -z "$PR" ] || [ "$PR" = "null" ]; then
  echo "::error::No pull_request.number in the event payload; cannot bundle." >&2
  exit 1
fi
if [ "$MODE" = "pages" ] && [ ! -d "${WEB_DIR:-}" ]; then
  echo "::error::WEB_DIR '${WEB_DIR:-}' is not a directory; nothing to bundle." >&2
  exit 1
fi

SITE="${RUNNER_TEMP}/rm-site"
STORE_DIR="${RUNNER_TEMP}/rm-store"
TAR="${RUNNER_TEMP}/artifact.tar"
rm -rf "$SITE" "$STORE_DIR" "$TAR"
mkdir -p "$SITE" "$STORE_DIR"

# --- restore the previous accumulated site, if one is still around -----------
# Every run persists a fresh `pages-store`, so the repository accumulates many
# artifacts of that name and the one to restore is the NEWEST. Artifact ids are
# assigned monotonically, so the highest id is the newest, independent of the
# order the API happens to list them in and of how many pages the listing spans
# (--paginate walks them all). A missing/failed restore is non-fatal: we start a
# fresh site (first run, or the store aged out past its retention). Watch for
# "starting a fresh site" on runs that should have had prior PRs — that usually
# means the `actions: read` permission is missing.
newest="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/actions/artifacts?name=${STORE_NAME}&per_page=100" \
  --jq '.artifacts[] | select(.expired == false) | "\(.id)\t\(.created_at)\t\(.workflow_run.id // "-")"' 2>/dev/null \
  | sort -t "$(printf '\t')" -k1,1n | tail -n 1 || true)"

if [ -n "$newest" ]; then
  artifact_id="${newest%%$'\t'*}"
  echo "Restoring previous site from ${STORE_NAME} artifact ${artifact_id} (created ${newest#*$'\t'})"
  if gh api "repos/${GITHUB_REPOSITORY}/actions/artifacts/${artifact_id}/zip" > "${RUNNER_TEMP}/store.zip" 2>/dev/null \
     && [ -s "${RUNNER_TEMP}/store.zip" ] \
     && unzip -oq "${RUNNER_TEMP}/store.zip" -d "$STORE_DIR"; then
    if [ -f "${STORE_DIR}/site.tar" ]; then
      tar -xf "${STORE_DIR}/site.tar" -C "$SITE"
    else
      # A store written before the site was tarred: the artifact holds the
      # bare directory tree. Read it as-is; this run re-saves it as a tar.
      cp -a "${STORE_DIR}/." "$SITE/"
    fi
  else
    echo "::warning::Could not download or unpack ${STORE_NAME} artifact ${artifact_id}; starting a fresh site." >&2
  fi
else
  echo "No previous ${STORE_NAME} found; starting a fresh site."
fi

# --- add or remove THIS PR's folder -----------------------------------------
DEST="${SITE}/refactorings/pr-${PR}"
DEPLOY=true
case "$MODE" in
  pages)
    rm -rf "$DEST"
    mkdir -p "$DEST"
    cp -a "${WEB_DIR}/." "$DEST/"
    ;;
  remove)
    if [ -d "$DEST" ]; then
      rm -rf "$DEST"
      echo "Removed refactorings/pr-${PR} for the closed PR."
    else
      echo "PR #${PR} has no published view; nothing to remove or deploy."
      DEPLOY=false
    fi
    ;;
  *)
    echo "::error::Unknown MODE '${MODE}'" >&2
    exit 1
    ;;
esac

# --- root index: the site's own list of what is published ------------------
# deploy-pages serves the tar as-is (no Jekyll), and each PR's view lives at
# refactorings/pr-<n>/list/, so the root would otherwise be a 404. Rebuilt
# from the folders present every run, so a removed PR drops off it.
mkdir -p "${SITE}/refactorings"
{
  echo '<!doctype html><html lang="en"><head><meta charset="utf-8">'
  echo '<meta name="viewport" content="width=device-width,initial-scale=1">'
  echo "<title>RefactoringMiner diffs — ${GITHUB_REPOSITORY}</title>"
  echo '<style>body{font:15px/1.5 system-ui,sans-serif;max-width:40rem;margin:3rem auto;padding:0 1rem;color:#1f2328}'
  echo 'h1{font-size:1.25rem}ul{padding-left:1.25rem}li{margin:.25rem 0}code{font-family:ui-monospace,monospace}</style></head><body>'
  echo "<h1>RefactoringMiner interactive diffs</h1><p><code>${GITHUB_REPOSITORY}</code></p><ul>"
  find "${SITE}/refactorings" -mindepth 1 -maxdepth 1 -type d -name 'pr-*' -printf '%f\n' \
    | sed 's/^pr-//' | sort -n | while read -r n; do
      echo "<li><a href=\"refactorings/pr-${n}/list/\">Pull request #${n}</a></li>"
    done
  echo '</ul></body></html>'
} > "${SITE}/index.html"

# --- tar the whole site -------------------------------------------------------
# Same flags actions/upload-pages-artifact uses, so deploy-pages accepts it
# unchanged. One tar, two names: upload-artifact keeps a file's own name inside
# the artifact, and the deploy wants artifact.tar while the store is named
# site.tar so a restore can tell a tarred store from a legacy directory-tree
# one. Hard links, so the second copy is free.
BUNDLE="${RUNNER_TEMP}/rm-bundle"
rm -rf "$BUNDLE"
mkdir -p "$BUNDLE"
if [ "$DEPLOY" = true ]; then
  tar --dereference --hard-dereference --directory "$SITE" -cf "${BUNDLE}/artifact.tar" --exclude=.git --exclude=.github .
  ln "${BUNDLE}/artifact.tar" "${BUNDLE}/site.tar" 2>/dev/null || cp "${BUNDLE}/artifact.tar" "${BUNDLE}/site.tar"
fi

{
  echo "site-dir=${SITE}"
  echo "pr-number=${PR}"
  echo "deploy=${DEPLOY}"
  if [ "$DEPLOY" = true ]; then
    echo "deploy-tar=${BUNDLE}/artifact.tar"
    echo "store-tar=${BUNDLE}/site.tar"
  fi
} >> "$GITHUB_OUTPUT"

echo "Bundled PR #${PR} (mode=${MODE}, deploy=${DEPLOY}). Site now contains: $(find "${SITE}/refactorings" -mindepth 1 -maxdepth 1 -type d -printf '%f ' 2>/dev/null)"

# Local testing harness

Runs the compiled action (`dist/export/index.js` then `dist/comment/index.js`)
against a **local** Docker image, reproducing the GitHub Actions runtime
without pushing to GitHub.

## Prerequisites

1. Docker Desktop running (`open -a Docker`).
2. Your local image loaded — default tag `testimage:latest`
   (check with `docker images`).
3. A Java git repo to analyze — defaults to the sibling `RefactoringMiner` checkout.
4. `npm run build` has been run so `dist/export/index.js` and `dist/comment/index.js` are current.

## Usage

```sh
# commit-analysis path (default): docker run + print report, no GitHub API
./run-local.sh

# full PR path: docker analysis + web-view export + PR comment attempt
EVENT=pull_request ENABLE_WEB_VIEW=true ./run-local.sh
```

Override config via env vars:

```sh
IMAGE=testimage:latest \
WORKSPACE="/path/to/java/repo" \
SHA=<commit> BASE_SHA=<base-commit> \
./run-local.sh
```

## How it works

- `shim/docker` is prepended to `PATH`. The action always runs `docker pull`
  first; a local-only image isn't on a registry, so the shim turns `pull` into
  a no-op and forwards every other `docker` call to the real binary.
- `env` sets the plain `GITHUB_TOKEN` / `RM_IMAGE` / `ENABLE_WEB_VIEW` vars that
  `export.js` reads directly, plus the `GITHUB_*` runtime vars — matching how
  the composite `action.yml` wires `inputs.*` into each step's `env:` block.
- `GITHUB_OUTPUT` is pointed at a scratch file so `core.setOutput` calls in
  `export.js` land there, exactly like the real runtime; the script parses
  `mode` / `web-dir` / `view-url` / `refactorings-path` back out of it before
  invoking `comment.js`.
- `event-push.json` is the push payload; `event-pr.generated.json` is written
  on the fly for the PR path with SHAs resolved from the workspace repo.

## Notes

- **PR path with `ENABLE_WEB_VIEW=true`:** `export.js` will call the real
  GitHub Pages API to decide a target; with the dummy token this call fails
  and it falls back to `mode=artifact` (a real `@actions/artifact` upload,
  which also needs a real Actions runtime to succeed). The multi-PR bundle
  (`scripts/bundle-site.sh`) and the Pages deploy (`actions/deploy-pages`)
  only run as real composite-action steps in CI — this harness can't
  exercise them, since they need the runtime's artifact store and OIDC token.
- Posting the comment hits the GitHub API. With the default dummy token that
  call will fail (everything up to it still runs). To post for real, set
  `GITHUB_TOKEN=<pat>` and `REPOSITORY=<owner/repo>` for a repo you can write to.
- The action's source is never modified — only the runtime environment is faked.

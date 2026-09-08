const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_IMAGE = 'tsantalis/refactoringminer:latest';
const CONTAINER_EXPORT = '/diff/exported';
const RM_JAR = '/opt/refactoringminer/lib/RefactoringMiner-DockerBuild.jar';

// Companion-extension feed: a copy of RefactoringMiner's `jsons/refactorings.json`
// placed inside the web view so it publishes alongside it (Pages + artifact).
// The browser extension fetches this and renders the overlays itself, reusing
// this single RefactoringMiner run instead of recomputing anything client-side.
// The copy is made inside the container (as root) because the export dirs are
// root-owned on the host — the non-root action process can't write into them.
const FEED_FILE = 'refactorings.json';

/**
 * Builds the GitHub URL that RefactoringMiner's `diff --url` mode analyzes.
 * Prefers the PR's html_url from the event payload; otherwise constructs a
 * commit URL from the standard GitHub Actions environment.
 */
function buildAnalysisUrl(eventName, eventPath) {
  if (eventName === 'pull_request') {
    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));
    return event.pull_request.html_url;
  }

  const server = process.env.GITHUB_SERVER_URL || 'https://github.com';
  return `${server}/${process.env.GITHUB_REPOSITORY}/commit/${process.env.GITHUB_SHA}`;
}

/**
 * Runs RefactoringMiner's `diff --url <url> --export` once and returns both
 * products of that single call:
 *
 *   - webDir: the self-contained interactive AST-diff site (`web/`), ready to
 *     publish to Pages or upload as an artifact.
 *   - refactorings: the parsed `jsons/refactorings.json` array. Each entry has a
 *     `markup` field whose code elements are already linked to the exact GitHub
 *     diff lines by RefactoringMiner itself (toMarkupStringWithGitHubLinks), so
 *     the action never has to build those links.
 *
 * Mirrors the proven recipe from EmpiricalSEConcordia/Refactoringminer-Astdiff-Exporter:
 * `refactoringminer diff --url <url> -e` writes the diff pages and the JSON, and
 * the Monaco editor + JS/CSS resources are copied out of the image's jar into
 * web/resources.
 *
 * The temp directory is created with mkdtempSync (mode 0700) for symlink safety.
 */
async function exportDiff(eventName, eventPath, image = DEFAULT_IMAGE, token = '') {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-web-'));
  const url = buildAnalysisUrl(eventName, eventPath);

  core.info(`Exporting interactive diff for ${url}...`);
  await exec.exec('docker', [
    'run', '--rm',
    '--env', `OAuthToken=${token}`,
    '-v', `${tmpDir}:${CONTAINER_EXPORT}`,
    '--entrypoint', '/bin/sh',
    image,
    '-c',
    `refactoringminer diff --url "${url}" -e && ` +
      `unzip -o ${RM_JAR} -d /tmp/rm > /dev/null && ` +
      `mkdir -p ${CONTAINER_EXPORT}/web && ` +
      `cp -r /tmp/rm/web ${CONTAINER_EXPORT}/web/resources && ` +
      `{ cp ${CONTAINER_EXPORT}/jsons/${FEED_FILE} ${CONTAINER_EXPORT}/web/${FEED_FILE} || true; }`,
  ]);

  const webDir = path.join(tmpDir, 'web');
  if (!fs.existsSync(path.join(webDir, 'list', 'index.html'))) {
    throw new Error(`Expected exported web view at ${webDir} was not produced`);
  }

  return { webDir, refactorings: readRefactorings(tmpDir) };
}

/**
 * Reads the `jsons/refactorings.json` that `diff --export` writes next to the
 * web view, and returns its `refactorings` array. Each entry carries `markup`
 * (GitHub-linked, used by the PR comment) plus `leftSideLocations`/
 * `rightSideLocations` — the `CodeRange`s the extension overlays from the
 * published copy of this same file. Throws if it's absent, which signals the
 * image predates the JSON/markup export and must be updated.
 */
function readRefactorings(tmpDir) {
  const jsonPath = path.join(tmpDir, 'jsons', FEED_FILE);
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `RefactoringMiner did not produce ${jsonPath}. The image must include the ` +
        `markup JSON export (DiffDriver writes jsons/refactorings.json on --export).`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return Array.isArray(parsed.refactorings) ? parsed.refactorings : [];
}

module.exports = { exportDiff, buildAnalysisUrl, readRefactorings };

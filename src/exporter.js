const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_IMAGE = 'tsantalis/refactoringminer:latest';
const CONTAINER_EXPORT = '/diff/exported';
const RM_JAR = '/opt/refactoringminer/lib/RefactoringMiner-DockerBuild.jar';

// Companion-extension feed, published next to the web view. The browser
// extension fetches this and renders the overlays itself, reusing this single
// RefactoringMiner run instead of recomputing anything client-side.
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
      `cp -r /tmp/rm/web ${CONTAINER_EXPORT}/web/resources`,
  ]);

  const webDir = path.join(tmpDir, 'web');
  if (!fs.existsSync(path.join(webDir, 'list', 'index.html'))) {
    throw new Error(`Expected exported web view at ${webDir} was not produced`);
  }

  const exported = readExport(tmpDir);
  writeFeed(webDir, url, exported);

  return { webDir, refactorings: exported.refactorings };
}

/**
 * Reads the `jsons/refactorings.json` that `diff --export` writes next to the
 * web view. Each refactoring carries `markup` (GitHub-linked, used by the PR
 * comment) plus `leftSideLocations`/`rightSideLocations` (the `CodeRange`s the
 * extension overlays). Throws if the file is absent, which signals the image
 * predates the JSON/markup export and must be updated.
 */
function readExport(tmpDir) {
  const jsonPath = path.join(tmpDir, 'jsons', 'refactorings.json');
  if (!fs.existsSync(jsonPath)) {
    throw new Error(
      `RefactoringMiner did not produce ${jsonPath}. The image must include the ` +
        `markup JSON export (DiffDriver writes jsons/refactorings.json on --export).`,
    );
  }

  const parsed = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  return {
    url: typeof parsed.url === 'string' ? parsed.url : '',
    refactorings: Array.isArray(parsed.refactorings) ? parsed.refactorings : [],
  };
}

/**
 * Writes the companion-extension feed into the web view so publisher's
 * `cpSync(webDir, …)` carries it to `refactorings/pr-<n>/refactorings.json`
 * (Pages) or into the artifact. Shape mirrors RefactoringMiner's classic
 * `-json` output — `{ commits: [ { url, refactorings:[…] } ] }` — which is what
 * the extension's overlay engine already expects.
 */
function writeFeed(webDir, analysisUrl, exported) {
  const feed = { commits: [{ url: exported.url || analysisUrl, refactorings: exported.refactorings }] };
  fs.writeFileSync(path.join(webDir, FEED_FILE), JSON.stringify(feed));
}

module.exports = { exportDiff, buildAnalysisUrl, readExport };

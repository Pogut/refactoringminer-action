const core = require('@actions/core');
const { getOctokit } = require('@actions/github');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportDiff } = require('./exporter');
const { buildComment } = require('./formatter');
const { decideTarget, ensurePagesEnabled, uploadArtifactView } = require('./publisher');

/**
 * First half of the action, run as a plain node step of the composite action.
 * Produces the interactive web view and refactorings JSON, decides where the
 * view should be published, and (for the Pages path) hands the exported
 * directory off via outputs so the action's bundle → upload → deploy steps can
 * do the actual publish. That is what makes publishing fast: GitHub's
 * Actions-based Pages deployment swaps a CDN artifact, instead of the old
 * push-to-gh-pages-branch build queue.
 *
 * Sets `mode` to one of:
 *   skip     — nothing to do (a closed PR with the web view disabled)
 *   remove   — the PR closed: the bundle step deletes its folder and redeploys
 *   log      — not a pull request; the report was written to the log here
 *   pages    — deploy via the composite steps (web-dir is set)
 *   artifact — already uploaded as a workflow artifact here (view-url is set)
 *   no-view  — post the comment without a view link
 *
 * Inputs arrive as plain env vars, wired from `inputs.*` by action.yml, rather
 * than through core.getInput: a composite action's steps don't receive the
 * INPUT_* variables a node action does.
 */
async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const image = process.env.RM_IMAGE || 'tsantalis/refactoringminer:latest';
    const enableWebView = (process.env.ENABLE_WEB_VIEW || 'true') !== 'false';

    const eventName = process.env.GITHUB_EVENT_NAME;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const serverUrl = process.env.GITHUB_SERVER_URL || 'https://github.com';
    const runId = process.env.GITHUB_RUN_ID;
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/');

    const event = JSON.parse(fs.readFileSync(eventPath, 'utf8'));

    // A closed PR: no analysis. With the web view on, the bundle step removes
    // the PR's folder from the published site so it isn't left behind forever.
    if (eventName === 'pull_request' && event.action === 'closed') {
      core.setOutput('pr-number', event.pull_request.number);
      core.setOutput('mode', enableWebView ? 'remove' : 'skip');
      return;
    }

    // One RefactoringMiner call produces everything we need: the interactive web
    // diff AND the refactorings JSON whose `markup` is already linked to the
    // exact GitHub diff lines. No separate commit-analysis run.
    const { webDir, refactorings } = await exportDiff(eventName, eventPath, image, token);

    if (eventName !== 'pull_request') {
      core.info(buildComment(refactorings));
      core.setOutput('mode', 'log');
      return;
    }

    core.setOutput('pr-number', event.pull_request.number);

    // The comment step runs after the deploy, in its own process: hand it the
    // JSON through a file rather than an output, which has a size limit.
    const feedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rm-feed-'));
    const refactoringsPath = path.join(feedDir, 'refactorings.json');
    fs.writeFileSync(refactoringsPath, JSON.stringify(refactorings));
    core.setOutput('refactorings-path', refactoringsPath);

    if (!enableWebView) {
      core.setOutput('mode', 'no-view');
      return;
    }

    const octokit = getOctokit(token);
    const target = await decideTarget(octokit, owner, repo, event.repository.private);

    if (target === 'pages' || target === 'pages-unconfigured') {
      try {
        if (target === 'pages-unconfigured') {
          await ensurePagesEnabled(octokit, owner, repo);
        }
        core.setOutput('mode', 'pages');
        core.setOutput('web-dir', webDir);
      } catch (error) {
        core.warning(`Interactive diff view unavailable: ${error.message}`);
        core.setOutput('mode', 'no-view');
      }
      return;
    }

    try {
      const url = await uploadArtifactView({ webDir, serverUrl, owner, repo, runId });
      core.setOutput('mode', 'artifact');
      core.setOutput('view-url', url);
    } catch (error) {
      core.warning(`Interactive diff view unavailable: ${error.message}`);
      core.setOutput('mode', 'no-view');
    }
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

const core = require('@actions/core');
const { getOctokit } = require('@actions/github');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { exportDiff } = require('./exporter');
const { buildComment } = require('./formatter');
const { decideTarget, ensurePagesEnabled, uploadArtifactView } = require('./publisher');

/**
 * First half of the action, run as a plain node step. Produces the
 * interactive web view and refactorings JSON, decides where the view should
 * be published, and (for the Pages path) hands the exported directory off via
 * outputs so the composite action's `actions/upload-pages-artifact` +
 * `actions/deploy-pages` steps can do the actual deploy — that's what makes
 * publishing fast, since it uses GitHub's Actions-based Pages deployment
 * instead of the old push-to-gh-pages-branch build queue.
 *
 * Sets `mode` to one of: skip (PR closed, nothing to do), log (push event,
 * already logged here), pages (deploy via the composite steps), artifact
 * (already uploaded here), no-view (post a comment without a view link).
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

    if (eventName === 'pull_request' && event.action === 'closed') {
      core.setOutput('mode', 'skip');
      return;
    }

    const { webDir, refactorings } = await exportDiff(eventName, eventPath, image, token);

    if (eventName !== 'pull_request') {
      core.info(buildComment(refactorings));
      core.setOutput('mode', 'log');
      return;
    }

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

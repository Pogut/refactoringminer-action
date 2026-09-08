const core = require('@actions/core');
const fs = require('fs');
const { buildComment } = require('./formatter');
const { postOrUpdateComment } = require('./commenter');

/**
 * Second half of the action: runs after the composite action's bundle and
 * Pages-deploy steps (if any) and posts the PR comment, linking the view that
 * was either deployed via `actions/deploy-pages` or uploaded as a workflow
 * artifact by export.js.
 *
 * A Pages deploy that didn't succeed (or a bundle step that failed before it)
 * degrades to a comment without a view link, plus a warning in the run log —
 * the summary is still worth posting on its own.
 */
async function run() {
  try {
    const token = process.env.GITHUB_TOKEN;
    const eventPath = process.env.GITHUB_EVENT_PATH;
    const mode = process.env.MODE;
    const refactorings = JSON.parse(fs.readFileSync(process.env.REFACTORINGS_PATH, 'utf8'));

    let view;
    if (mode === 'pages' && process.env.DEPLOY_OUTCOME === 'success' && process.env.VIEW_URL) {
      view = { url: process.env.VIEW_URL, kind: 'pages' };
    } else if (mode === 'artifact' && process.env.VIEW_URL) {
      view = { url: process.env.VIEW_URL, kind: 'artifact' };
    } else if (mode === 'pages') {
      core.warning('GitHub Pages deployment did not succeed; posting the comment without a view link.');
    }

    const body = buildComment(refactorings, view);
    await postOrUpdateComment(token, body, eventPath);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();

const core = require('@actions/core');
const fs = require('fs');
const { buildComment } = require('./formatter');
const { postOrUpdateComment } = require('./commenter');

/**
 * Second half of the action: runs after the composite action's Pages-deploy
 * steps (if any) and posts the PR comment, linking the view that was either
 * deployed via `actions/deploy-pages` or uploaded as an artifact in export.js.
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

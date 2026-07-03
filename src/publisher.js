const core = require('@actions/core');
const { DefaultArtifactClient } = require('@actions/artifact');
const fs = require('fs');
const path = require('path');

const ARTIFACT_NAME = 'refactoring-diff';

/**
 * Decides where to publish the exported web view.
 *
 *   private repo                              -> 'artifact'
 *   Pages unconfigured (404)                   -> 'pages-unconfigured'  (needs createPagesSite first)
 *   Pages already deployed via Actions workflow -> 'pages'  (ready to deploy straight away)
 *   Pages served any other way (branch build)   -> 'artifact'  (don't reconfigure someone else's site)
 *
 * The unconfigured/ready distinction matters because the default GITHUB_TOKEN
 * cannot call createPagesSite at all (GitHub restricts that endpoint to a PAT
 * or GitHub App with admin rights) — it 403s even when the site already
 * exists, rather than 409ing. So that call must only be attempted when Pages
 * genuinely isn't set up yet; an already-enabled site must skip straight to
 * 'pages' or every run would fail there before ever reaching the deploy step.
 */
async function decideTarget(octokit, owner, repo, isPrivate) {
  if (isPrivate) {
    return 'artifact';
  }

  try {
    const { data } = await octokit.rest.repos.getPages({ owner, repo });
    if (data.build_type === 'workflow') {
      return 'pages';
    }
    if (data.source?.branch === 'gh-pages') {
      core.warning(
        'GitHub Pages is currently deployed from the gh-pages branch (legacy build). ' +
        'To get fast Actions-based deploys, switch Settings → Pages → Build and deployment → ' +
        'Source to "GitHub Actions" once; falling back to a workflow artifact for now.',
      );
    }
    return 'artifact';
  } catch (err) {
    if (err.status === 404) {
      return 'pages-unconfigured';
    }
    core.warning(`Could not query GitHub Pages (${err.message}); falling back to artifact.`);
    return 'artifact';
  }
}

/** Enables GitHub Pages in "deploy from GitHub Actions" mode. Only call this for 'pages-unconfigured'. */
async function ensurePagesEnabled(octokit, owner, repo) {
  try {
    await octokit.rest.repos.createPagesSite({ owner, repo, build_type: 'workflow' });
  } catch (err) {
    throw new Error(
      `GitHub Pages could not be enabled automatically (${err.message}). The default GITHUB_TOKEN ` +
      'cannot create a Pages site — enable it once under Settings → Pages → Source → "GitHub Actions".',
    );
  }
}

function listFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? listFiles(full) : [full];
  });
}

/** Uploads the web view as a workflow artifact; returns the run page URL. */
async function uploadArtifactView({ webDir, serverUrl, owner, repo, runId }) {
  const client = new DefaultArtifactClient();
  await client.uploadArtifact(ARTIFACT_NAME, listFiles(webDir), webDir);
  return `${serverUrl}/${owner}/${repo}/actions/runs/${runId}`;
}

module.exports = {
  decideTarget,
  ensurePagesEnabled,
  uploadArtifactView,
  ARTIFACT_NAME,
};

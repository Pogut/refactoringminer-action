jest.mock('@actions/core');
jest.mock('@actions/artifact', () => ({
  DefaultArtifactClient: jest.fn().mockImplementation(() => ({
    uploadArtifact: jest.fn().mockResolvedValue({ id: 1 }),
  })),
}));
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  readdirSync: jest.fn(() => [{ name: 'index.html', isDirectory: () => false }]),
}));

const { decideTarget, ensurePagesEnabled, uploadArtifactView } = require('../src/publisher');

function octokitWithPages(impl) {
  return { rest: { repos: { getPages: impl, createPagesSite: jest.fn().mockResolvedValue({}) } } };
}

// ---------------------------------------------------------------------------
// decideTarget
// ---------------------------------------------------------------------------
describe('decideTarget', () => {
  test('private repos always use the artifact path', async () => {
    const octokit = octokitWithPages(jest.fn());
    expect(await decideTarget(octokit, 'o', 'r', true)).toBe('artifact');
    expect(octokit.rest.repos.getPages).not.toHaveBeenCalled();
  });

  test('unconfigured Pages (404) selects the pages path', async () => {
    const octokit = octokitWithPages(jest.fn().mockRejectedValue({ status: 404 }));
    expect(await decideTarget(octokit, 'o', 'r', false)).toBe('pages');
  });

  test('Pages already deployed via GitHub Actions selects the pages path', async () => {
    const octokit = octokitWithPages(jest.fn().mockResolvedValue({
      data: { build_type: 'workflow', source: null },
    }));
    expect(await decideTarget(octokit, 'o', 'r', false)).toBe('pages');
  });

  test('Pages served from the legacy gh-pages branch falls back to artifact', async () => {
    const octokit = octokitWithPages(jest.fn().mockResolvedValue({
      data: { build_type: 'legacy', source: { branch: 'gh-pages', path: '/' } },
    }));
    expect(await decideTarget(octokit, 'o', 'r', false)).toBe('artifact');
  });

  test('Pages served from another branch falls back to artifact', async () => {
    const octokit = octokitWithPages(jest.fn().mockResolvedValue({
      data: { build_type: 'legacy', source: { branch: 'main', path: '/docs' } },
    }));
    expect(await decideTarget(octokit, 'o', 'r', false)).toBe('artifact');
  });

  test('unexpected API errors fall back to artifact', async () => {
    const octokit = octokitWithPages(jest.fn().mockRejectedValue({ status: 500, message: 'boom' }));
    expect(await decideTarget(octokit, 'o', 'r', false)).toBe('artifact');
  });
});

// ---------------------------------------------------------------------------
// ensurePagesEnabled
// ---------------------------------------------------------------------------
describe('ensurePagesEnabled', () => {
  test('creates the Pages site in Actions-deploy mode', async () => {
    const createPagesSite = jest.fn().mockResolvedValue({});
    const octokit = { rest: { repos: { createPagesSite } } };
    await ensurePagesEnabled(octokit, 'o', 'r');
    expect(createPagesSite).toHaveBeenCalledWith({ owner: 'o', repo: 'r', build_type: 'workflow' });
  });

  test('treats a 409 (already enabled) as success', async () => {
    const octokit = { rest: { repos: { createPagesSite: jest.fn().mockRejectedValue({ status: 409 }) } } };
    await expect(ensurePagesEnabled(octokit, 'o', 'r')).resolves.toBeUndefined();
  });

  test('throws on unexpected errors', async () => {
    const octokit = { rest: { repos: { createPagesSite: jest.fn().mockRejectedValue({ status: 403, message: 'nope' }) } } };
    await expect(ensurePagesEnabled(octokit, 'o', 'r')).rejects.toThrow('nope');
  });
});

// ---------------------------------------------------------------------------
// uploadArtifactView
// ---------------------------------------------------------------------------
describe('uploadArtifactView', () => {
  test('returns the workflow run URL', async () => {
    const url = await uploadArtifactView({
      webDir: '/tmp/web', serverUrl: 'https://github.com',
      owner: 'o', repo: 'r', runId: '999',
    });
    expect(url).toBe('https://github.com/o/r/actions/runs/999');
  });
});

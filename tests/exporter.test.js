jest.mock('@actions/core');
jest.mock('@actions/exec');
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdtempSync: jest.fn(),
  readFileSync: jest.fn(),
  existsSync: jest.fn(),
}));

const core = require('@actions/core');
const exec = require('@actions/exec');
const fs = require('fs');
const { buildAnalysisUrl, exportDiff } = require('../src/exporter');

const FAKE_TMP = '/tmp/rm-web-fakeXYZ';

const REFACTORINGS_JSON = JSON.stringify({
  url: 'https://github.com/o/r/pull/7/changes',
  refactorings: [
    {
      type: 'Rename Method',
      description: 'Rename Method a() to b()',
      markup: '**Rename Method** [a()](https://github.com/o/r/pull/7/changes?diff=split#diff-hL1) renamed to [b()](https://github.com/o/r/pull/7/changes?diff=split#diff-hR1) in class `C`',
    },
  ],
});

const EVENT_JSON = JSON.stringify({ pull_request: { html_url: 'https://github.com/o/r/pull/7' } });

// readFileSync serves either the event payload or refactorings.json by path.
function fileByPath(p) {
  return String(p).endsWith('refactorings.json') ? REFACTORINGS_JSON : EVENT_JSON;
}

// ---------------------------------------------------------------------------
// buildAnalysisUrl
// ---------------------------------------------------------------------------
describe('buildAnalysisUrl', () => {
  const originalEnv = process.env;
  beforeEach(() => { process.env = { ...originalEnv }; jest.clearAllMocks(); });
  afterEach(() => { process.env = originalEnv; });

  test('uses the PR html_url for pull_request events', () => {
    fs.readFileSync.mockReturnValue(EVENT_JSON);
    expect(buildAnalysisUrl('pull_request', '/event.json')).toBe('https://github.com/o/r/pull/7');
  });

  test('constructs a commit URL for push events', () => {
    process.env.GITHUB_SERVER_URL = 'https://github.com';
    process.env.GITHUB_REPOSITORY = 'o/r';
    process.env.GITHUB_SHA = 'deadbeef';
    expect(buildAnalysisUrl('push', null)).toBe('https://github.com/o/r/commit/deadbeef');
  });
});

// ---------------------------------------------------------------------------
// exportDiff
// ---------------------------------------------------------------------------
describe('exportDiff', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    fs.mkdtempSync.mockReturnValue(FAKE_TMP);
    fs.readFileSync.mockImplementation(fileByPath);
    fs.existsSync.mockReturnValue(true);
    exec.exec.mockResolvedValue(0);
    core.info.mockReturnValue(undefined);
  });

  test('runs the diff --url export with the analysis URL and token', async () => {
    await exportDiff('pull_request', '/event.json', 'tsantalis/refactoringminer:latest', 'tok123');
    const [cmd, args] = exec.exec.mock.calls[0];
    const script = args[args.length - 1];
    expect(cmd).toBe('docker');
    expect(args).toContain('OAuthToken=tok123');
    expect(args).toContain('tsantalis/refactoringminer:latest');
    expect(script).toContain('refactoringminer diff --url "https://github.com/o/r/pull/7" -e');
    expect(script).toContain('web/resources');
  });

  test('mounts the temp dir at the container export path', async () => {
    await exportDiff('pull_request', '/event.json', 'img', 'tok');
    const [, args] = exec.exec.mock.calls[0];
    expect(args).toContain(`${FAKE_TMP}:/diff/exported`);
  });

  test('returns the exported web directory path', async () => {
    const { webDir } = await exportDiff('pull_request', '/event.json', 'img', 'tok');
    expect(webDir).toBe(`${FAKE_TMP}/web`);
  });

  test('returns the parsed refactorings from jsons/refactorings.json', async () => {
    const { refactorings } = await exportDiff('pull_request', '/event.json', 'img', 'tok');
    expect(refactorings).toHaveLength(1);
    expect(refactorings[0].type).toBe('Rename Method');
    expect(refactorings[0].markup).toContain('[a()](');
    expect(refactorings[0].markup).toContain('in class `C`');
  });

  test('copies the refactorings feed into the web view inside the container', async () => {
    await exportDiff('pull_request', '/event.json', 'img', 'tok');
    const [, args] = exec.exec.mock.calls[0];
    const script = args[args.length - 1];
    expect(script).toContain('cp /diff/exported/jsons/refactorings.json /diff/exported/web/refactorings.json');
  });

  test('throws when the export did not produce a web view', async () => {
    fs.existsSync.mockReturnValue(false);
    await expect(exportDiff('pull_request', '/event.json', 'img', 'tok'))
      .rejects.toThrow('was not produced');
  });

  test('throws when refactorings.json is missing', async () => {
    fs.existsSync.mockImplementation((p) => !String(p).endsWith('refactorings.json'));
    await expect(exportDiff('pull_request', '/event.json', 'img', 'tok'))
      .rejects.toThrow('refactorings.json');
  });
});

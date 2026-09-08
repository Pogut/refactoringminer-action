# RefactoringMiner Action

Detects refactorings in a pull request, posts a grouped markdown summary as a PR comment, and links reviewers to RefactoringMiner's **interactive AST-diff view**.

Built on [RefactoringMiner](https://github.com/tsantalis/RefactoringMiner) by Nikolaos Tsantalis.

## Quick start

Create `.github/workflows/refactorings.yml` in your repository:

```yaml
name: Refactoring Report

on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  contents: read         # read the pull request's diff
  pull-requests: write   # post the summary comment
  pages: write           # deploy the interactive diff to GitHub Pages
  id-token: write        # required by the Pages deployment
  actions: read          # restore the previously published PRs (see below)

# Serialize publishes so two PRs' runs can't overwrite each other's view.
concurrency:
  group: refactoring-pages-publish
  cancel-in-progress: false

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: Pogut/RefactoringMiner-action@v1
```

That is the entire workflow — note there is **no `actions/checkout` step**. RefactoringMiner is handed the pull request's URL and the job's token and reads the diff from GitHub directly, so nothing is read from the runner's filesystem. Adding a checkout (especially `fetch-depth: 0`) only costs you clone time.

Keep `closed` in `types:`. When a pull request closes, the action removes that PR's view from the published site instead of leaving it behind forever.

### One-time Pages setup

The interactive diff is deployed through GitHub's Actions-based Pages pipeline, so Pages has to be set to that source once:

**Settings → Pages → Build and deployment → Source: "GitHub Actions"**.

The action tries to do this for you on the first run, but the default `GITHUB_TOKEN` is not allowed to enable Pages, so on most repositories you will see a warning asking you to flip that setting by hand. After that every run deploys in seconds.

> **Upgrading from a version that published to a `gh-pages` branch?** Switch the Source above from "Deploy from a branch" to "GitHub Actions" (the branch itself can stay or go). Until you do, the action detects the legacy setup, falls back to the artifact link, and says so in the run log — it will not reconfigure a Pages site it didn't set up.

### Permissions

| Permission | Why it is needed |
|---|---|
| `contents: read` | Let RefactoringMiner read the pull request's files through the API. |
| `pull-requests: write` | Post the summary comment, and delete the previous one. |
| `pages: write` | Deploy the interactive diff to GitHub Pages. |
| `id-token: write` | `actions/deploy-pages` authenticates the deployment with an OIDC token. |
| `actions: read` | Download the previous run's `pages-store` artifact, so every open PR's view survives this one's deploy. |

If you want the comment only, set `enable-web-view: 'false'`; then `contents: read` and `pull-requests: write` are enough and the `concurrency:` group can go.

## What you get

A single comment on the pull request:

> ### RefactoringMiner Report
> Found 4 refactorings: 2 Extract Method, 1 Rename Parameter, 1 Move Attribute
>
> - **Extract Method** [private calculateTotal(unitPrice Int, quantity Int) : Int](#) extracted from [public buildReceipt(buyerName String, unitPrice Int) : String](#) in class `OrderProcessor`
> - **Rename Parameter** [customerName : String](#) to [buyerName : String](#) in method `public buildReceipt(...)` from class `OrderProcessor`
> - **Move Attribute** [private street : String](#) from class `CustomerProfile` to [private street : String](#) from class `Address`
>
> 🔍 **[View the interactive diff](#)**

Every code element is a link to the exact line in the PR's diff — RefactoringMiner generates those links itself, so they land on the right side of the split view.

When nothing is found, the comment reads _"No refactorings detected in this change."_

On each new push to the PR, the previous report is deleted and a fresh one posted, so the report always sits at the bottom of the conversation rather than staying pinned where it was first added.

## The interactive diff view

Alongside the comment, the action exports RefactoringMiner's full AST-diff web view and publishes it to **GitHub Pages**. Each pull request gets its own folder:

```
https://<owner>.github.io/<repo>/refactorings/pr-<number>/list/
```

The site root lists every pull request currently published, and each folder also carries that PR's `refactorings.json` — the feed the companion browser extension reads to overlay the refactorings onto GitHub's own diff.

### Every open PR stays published

GitHub's Actions-based Pages deployment replaces the whole site on every deploy, which on its own would mean each PR's run wipes out the others. The action gets around that by rebuilding the full site every run:

1. It restores the site from the newest **`pages-store`** artifact — its own long-retention copy of what is currently live, carried as a single tar.
2. It adds this PR's freshly exported view under `refactorings/pr-<number>/` (or removes that folder, when the PR closed).
3. It deploys the re-bundled tar to Pages, and — only if that deploy succeeded — saves the same tar as the next run's `pages-store`.

That is why the workflow needs `actions: read` (to fetch the previous store) and a `concurrency:` group (two runs can't merge their stores; serializing them means the second always starts from the first's result). The store is kept for 90 days by default — see the `store-retention-days` input — and a repository idle for longer than that simply starts a fresh site on its next PR.

### When it falls back to an artifact

If Pages can't be used, the view is uploaded as a workflow artifact named `refactoring-diff` and the comment links to the run instead. Download it and open `web/list/index.html`. This happens when:

- **the repository is private** — Pages sites would be public, so the action never publishes one for you; or
- **Pages is served from a branch** — the legacy "Deploy from a branch" source, including a `gh-pages` branch left over from an older version of this action. Switch the Source to "GitHub Actions" as described above.

If you are getting the artifact link and expected the published view, check the Source setting — that is almost always the cause.

## Inputs

| Input | Description | Required | Default |
|---|---|---|---|
| `github-token` | Token used to post the PR comment and publish the view. | No | `${{ github.token }}` |
| `image` | RefactoringMiner Docker image to run. Pin a specific tag for reproducible results. | No | `tsantalis/refactoringminer:latest` |
| `enable-web-view` | Export and publish the interactive AST-diff view. Set to `'false'` for comment-only runs. | No | `'true'` |
| `store-retention-days` | How long the bundled multi-PR site is kept between runs. A repository idle for longer starts a fresh site. | No | `'90'` |

### Pinning the RefactoringMiner version

```yaml
      - uses: Pogut/RefactoringMiner-action@v1
        with:
          image: tsantalis/refactoringminer:3.0.9
```

The image must be recent enough to write `jsons/refactorings.json` on `--export`; the action fails with a clear message if it isn't.

## How it works

1. On a `pull_request` event, the action runs `refactoringminer diff --url <pr-url> -e` inside the RefactoringMiner Docker image. That single run produces both the interactive web view and `jsons/refactorings.json`, and copies the JSON into the view so it publishes alongside it.
2. The comment is rendered from that JSON's `markup` field, which already carries GitHub deep links for every code element.
3. The view is bundled into the multi-PR site (restored from the previous `pages-store` artifact) and deployed to Pages through `actions/deploy-pages`, or uploaded as a workflow artifact when Pages can't be used. The comment links to whichever one happened.
4. When the PR closes, its folder is removed from the site and the site is redeployed without it. No analysis runs for a closed PR.
5. On other events the report is written to the workflow log instead of being posted as a comment.

The Docker image is pulled automatically — you do not need Java, RefactoringMiner, or any Docker setup of your own on the runner.

## Requirements

- **Linux runners only** (`ubuntu-latest` recommended). The action shells out to `docker run`, which hosted Windows and macOS runners do not provide. The bundling step also uses `gh`, `jq`, `tar` and `unzip`, all of which the hosted Ubuntu images carry; a self-hosted runner needs them installed.
- A **public repository** for the published Pages view. Private repositories still get the full view as a workflow artifact.

## Supported languages

Whatever the pinned RefactoringMiner image supports. Refactoring detection and AST-diff generation are both available for **Java, Python, Kotlin, TypeScript and JavaScript**; C++ parsing is in progress and not yet supported. See the [RefactoringMiner README](https://github.com/tsantalis/RefactoringMiner) for the authoritative, up-to-date table.

## License

GPL-3.0 — see [LICENSE](LICENSE). RefactoringMiner itself is developed and licensed separately by [Nikolaos Tsantalis and contributors](https://github.com/tsantalis/RefactoringMiner).

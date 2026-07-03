# RefactoringMiner Action

A GitHub Action that detects refactorings in pull requests, posts a markdown summary as a PR comment, and links reviewers to RefactoringMiner's **interactive AST-diff view**.

Built on top of [RefactoringMiner](https://github.com/tsantalis/RefactoringMiner) by Nikolaos Tsantalis.

> **Available on the [GitHub Marketplace](https://github.com/marketplace).** Add it from the Marketplace or reference it directly in a workflow as shown below — no manual setup or vendoring required.

## Quick start

Create `.github/workflows/refactorings.yml` in your repository:

```yaml
name: Refactoring Report
on:
  pull_request:
    types: [opened, synchronize, reopened, closed]

permissions:
  pages: write           # enable + deploy GitHub Pages
  id-token: write        # required to deploy Pages via GitHub Actions
  pull-requests: write   # post the PR comment

jobs:
  report:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: Pogut/refactoringminer-action@v1
```

That's it. On every pull request, the action analyzes the commit range and posts (or updates) a single summary comment.

- `fetch-depth: 0` is required so RefactoringMiner has the full commit history for range analysis.
- The `pull-requests: write` permission is required so the action can post the comment.

## Comment example

> ### RefactoringMiner Report
> Found 3 refactorings: 2 Extract Method, 1 Rename Variable
>
> - **Extract Method** — `computeTotal()` extracted from `checkout()` in `Cart.java`
> - **Extract Method** — `validateInput()` extracted from `submit()` in `FormHandler.java`
> - **Rename Variable** — `x` renamed to `itemCount` in `Inventory.java`
>
> 🔍 **[View the interactive diff](#)**

When no refactorings are found, the comment reads _"No refactorings detected in this change."_ The action reuses the same comment across pushes to a PR rather than posting a new one each time.

## Inputs

| Input | Description | Required | Default |
|---|---|---|---|
| `github-token` | Token used to post the PR comment. | No | `${{ github.token }}` |
| `image` | RefactoringMiner Docker image to run (e.g. `tsantalis/refactoringminer:3.0.9`). Pin a specific tag for reproducible results. | No | `tsantalis/refactoringminer:latest` |

### Pinning the RefactoringMiner version

```yaml
      - uses: Pogut/refactoringminer-action@v1
        with:
          image: tsantalis/refactoringminer:3.0.9
```

## How it works

1. On `pull_request` events, runs `refactoringminer -bc` across the commit range from base to head and posts a grouped summary as a PR comment.
2. On `push` events, runs `refactoringminer -c` against the pushed commit and logs the result to the workflow output.
3. The Docker image is pulled and run automatically — you don't need Java, Docker setup, or RefactoringMiner installed on the runner.

### Interactive diff hosting

On public repos, the exported view is deployed to **GitHub Pages via GitHub's
Actions-based deployment** (the same mechanism `actions/deploy-pages` uses) —
it publishes in seconds rather than going through the legacy branch-build
queue. Each run replaces the previously deployed diff. If Pages can't be used
(private repo, or Pages is already configured to deploy some other way), the
view is uploaded as a workflow artifact instead and linked from the run page.

> **Upgrading from an older version of this action?** If Pages was previously
> set up to deploy from a `gh-pages` branch, switch **Settings → Pages →
> Build and deployment → Source** to **"GitHub Actions"** once (or delete the
> `gh-pages` branch) so this action can redeploy in the fast mode above —
> otherwise it falls back to the artifact link and warns in the run log.

## Requirements

- **Linux runners only** (`ubuntu-latest` recommended). This is a Docker container action and does not run on Windows or macOS hosted runners.
- A checkout with full history (`fetch-depth: 0`).

## License

See [LICENSE](LICENSE).

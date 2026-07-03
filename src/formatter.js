const COMMENT_HEADER = '### RefactoringMiner Report';

/**
 * Renders the optional "view the interactive diff" footer.
 * @param {{ url: string, kind: 'pages' | 'artifact' } | undefined} view
 * @returns {string}
 */
function viewFooter(view) {
  if (!view || !view.url) {
    return '';
  }
  if (view.kind === 'pages') {
    return `\n\n🔍 **[View the interactive diff](${view.url})**`;
  }
  return `\n\n📦 Interactive diff exported as a workflow artifact — [open the run](${view.url}), download \`refactoring-diff\`, and open \`web/list/index.html\`.`;
}

/**
 * Renders a single refactoring as a bullet.
 *
 * RefactoringMiner already produces a `markup` field where code elements are
 * markdown links to the exact GitHub diff lines and class names are inline code
 * (toMarkupStringWithGitHubLinks). It starts with the bold refactoring name, so
 * we render it verbatim. `description` is the plain-text fallback for output
 * that predates the markup field (eg a non-GitHub remote, or an older image).
 *
 * @param {{ type: string, description?: string, markup?: string }} r
 * @returns {string}
 */
function renderRefactoring(r) {
  return `- ${r.markup || r.description || r.type}`;
}

/**
 * Builds a markdown comment body from the refactorings RefactoringMiner detected.
 * @param {Array<{ type: string, description?: string, markup?: string }>} refactorings
 *   The `refactorings` array from the exported `jsons/refactorings.json`.
 * @param {{ url: string, kind: 'pages' | 'artifact' }} [view] Optional interactive-view link.
 * @returns {string}
 */
function buildComment(refactorings, view) {
  const all = Array.isArray(refactorings) ? refactorings : [];
  const footer = viewFooter(view);

  if (all.length === 0) {
    return `${COMMENT_HEADER}\nNo refactorings detected in this change.${footer}`;
  }

  const counts = all.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {});

  const breakdown = Object.entries(counts)
    .map(([type, count]) => `${count} ${type}`)
    .join(', ');

  const details = all.map(renderRefactoring).join('\n');

  return `${COMMENT_HEADER}\nFound ${all.length} refactorings: ${breakdown}\n\n${details}${footer}`;
}

module.exports = { buildComment, COMMENT_HEADER };

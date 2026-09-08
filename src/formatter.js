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
 * Backslash-escapes the Markdown emphasis characters in a run of rendered text.
 *
 * GitHub treats `_` and `*` as emphasis delimiters, so Python identifiers carry
 * them straight into the rendered output: `__init__` becomes a bold "init",
 * `*args`/`**kwargs` turn italic/bold. Escaping them keeps the literal name.
 * Other punctuation in code elements (parens, colons, generics) is left alone.
 */
function escapeEmphasis(text) {
  return text.replace(/[_*]/g, '\\$&');
}

/**
 * Escapes emphasis only in the *rendered text* of RefactoringMiner's markup,
 * leaving the markup machinery untouched.
 *
 * toMarkupStringWithGitHubLinks emits three constructs: `**bold name**`,
 * `[link text](url)` and `` `inline code` ``. Emphasis is inert inside code
 * spans and inside the `(url)` (and the URL may legitimately contain `_`, eg a
 * repo named `my_repo`, so escaping it would break the link), so we leave those
 * verbatim and escape only the link text and the plain glue between constructs.
 * The literal `**` bold markers are preserved.
 *
 * Implemented as a single left-to-right scan over the string using `indexOf`
 * rather than a backtracking regex: it is linear in the input length (no
 * super-linear regex backtracking) and copes with `]`/`(`/`)` inside link text,
 * eg a Java `[String[] args](url)` or a signature `[foo()](url)`, by splitting
 * the link on the `](` separator rather than on the first `]`.
 */
function escapeMarkupEmphasis(markup) {
  let out = '';
  let i = 0;
  while (i < markup.length) {
    const c = markup[i];
    if (c === '`') {
      // `inline code` — copied verbatim.
      const end = markup.indexOf('`', i + 1);
      if (end !== -1) {
        out += markup.slice(i, end + 1);
        i = end + 1;
        continue;
      }
    } else if (c === '[') {
      // [text](url) — escape the text, keep the url verbatim.
      const sep = markup.indexOf('](', i + 1);
      if (sep !== -1) {
        const end = markup.indexOf(')', sep + 2);
        if (end !== -1) {
          out += `[${escapeEmphasis(markup.slice(i + 1, sep))}](${markup.slice(sep + 2, end)})`;
          i = end + 1;
          continue;
        }
      }
    } else if (c === '*' && markup[i + 1] === '*') {
      // ** bold marker — copied verbatim.
      out += '**';
      i += 2;
      continue;
    }
    // Anything else is plain glue text: escape its emphasis chars.
    out += escapeEmphasis(c);
    i += 1;
  }
  return out;
}

/**
 * Renders a single refactoring as a bullet.
 *
 * RefactoringMiner already produces a `markup` field where code elements are
 * markdown links to the exact GitHub diff lines and class names are inline code
 * (toMarkupStringWithGitHubLinks). It starts with the bold refactoring name. We
 * pass it through escapeMarkupEmphasis so identifiers with `_`/`*` (eg Python's
 * `__init__`) survive GitHub's Markdown rendering. `description` is the
 * plain-text fallback for output that predates the markup field (eg a non-GitHub
 * remote, or an older image); it carries the same identifiers, so it is fully
 * escaped too.
 *
 * @param {{ type: string, description?: string, markup?: string }} r
 * @returns {string}
 */
function renderRefactoring(r) {
  if (r.markup) {
    return `- ${escapeMarkupEmphasis(r.markup)}`;
  }
  if (r.description) {
    return `- ${escapeEmphasis(r.description)}`;
  }
  return `- ${r.type}`;
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

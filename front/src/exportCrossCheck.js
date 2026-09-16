import { findDoiUrl } from './component/Publications';
import { trimLastDigits } from './utils';
import { downloadTextFile, mdEscape, dblpTitleText } from './exportPublications';

// Shared by CrossCheck.js/CrossCheckTeam.js/CrossCheckStructure.js's own
// "Export Markdown" button -- the CSV export next to it stays 3 separate
// (near-identical) local functions, as it already was before this feature
// (see each file's own exportCsv), but the Markdown report below reads the
// exact same `results`/`member.results` shape all 3 already fetch, so it's
// factored out once rather than copy-pasted a third time.

// One DBLP publication's own line -- same rank/authors/title/venue/DOI
// fields as exportPublications.js's own dblp row (mdEscape/dblpTitleText
// imported from there so a title/venue escapes and renders the exact same
// way), just formatted inline instead of as its own bullet: a "To review"
// entry needs this same line followed by an indented HAL candidate list, not
// a bullet of its own.
function dblpPublicationLine(publication) {
  const rank = publication.rank?.value || 'Unranked';
  const authors = (publication.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed';
  const title = mdEscape(dblpTitleText(publication.dblp.title));
  const venue = mdEscape(publication.venue || '');
  const doiUrl = findDoiUrl(publication.dblp.ee);
  return `**[${rank}]** ${authors}. **${title}.** ${venue}${doiUrl ? ` [DOI](${doiUrl})` : ''}`;
}

// One HAL candidate line, indented under its DBLP publication -- `distance`
// (when present) is the same match-distance CrossCheck.js's own CSV export
// already surfaces (matches.map(m => ... d=${m.distance} ...)), carried here
// too so the report explains *why* a candidate was offered, not just what it
// is.
function halCandidateLine(halPub, distance) {
  const authors = (halPub.authors || []).map(a => a.name).join(', ') || 'No authors listed';
  const title = mdEscape(halPub.title);
  const venue = mdEscape(halPub.venue || '');
  const doiUrl = halPub.doi ? `https://doi.org/${halPub.doi}` : null;
  return `HAL ${halPub.year || '—'}: ${authors}. **${title}.** ${venue}${doiUrl ? ` [DOI](${doiUrl})` : ''}${distance != null ? ` _(distance ${distance})_` : ''}`;
}

// "Missing from HAL" / "To review" sections, mirroring the on-screen
// CrossCheckSection layout (see CrossCheck.js) -- a "To review" DBLP
// publication is followed by its HAL candidate(s) as a sub-list, same
// DBLP-then-candidates relationship the page itself shows top to bottom.
function renderResultsSections(results) {
  const missing = results.filter(r => r.status === 'missing');
  const toReview = results.filter(r => r.status === 'to-review');
  let out = `\n### Missing from HAL (${missing.length})\n\n`;
  out += missing.length ? missing.map(r => `- ${dblpPublicationLine(r.publication)}\n`).join('') : '_None_\n';
  out += `\n### To review (${toReview.length})\n\n`;
  out += toReview.length
    ? toReview.map(r => {
      let block = `- ${dblpPublicationLine(r.publication)}\n`;
      block += r.matches.map(m => `  - ${halCandidateLine(m.halPub, m.distance)}\n`).join('');
      return block;
    }).join('')
    : '_None_\n';
  return out;
}

// CrossCheck.js: one author's own report, no member grouping.
export function exportCrossCheckMarkdown({ title, filename, results }) {
  downloadTextFile(filename, `# ${title}\n${renderResultsSections(results)}`, 'text/markdown;charset=utf-8;');
}

// CrossCheckTeam.js/CrossCheckStructure.js: one section per resolved member,
// same grouping their own TeamMemberSection/StructureMemberSection already
// render on screen -- `memberLabel` picks the per-family heading text (a
// team member's "name (pid)" vs. a structure member's
// "name (idHal → DBLP pid)"), everything else about the report is identical
// between the two.
export function exportCrossCheckByMemberMarkdown({ title, filename, members, memberLabel }) {
  let body = '';
  for (const member of members) {
    body += `\n## ${memberLabel(member)}\n`;
    body += renderResultsSections(member.results);
  }
  downloadTextFile(filename, `# ${title}\n${body}`, 'text/markdown;charset=utf-8;');
}

// One result's own JSON shape -- same fields as its Markdown line
// (dblpPublicationLine) plus its HAL candidates (halCandidateLine), just
// structured instead of formatted into prose. `matches` stays present (as
// an empty array) even for a "missing" result rather than being omitted,
// the same way each CrossCheck*.js's own CSV export already includes a
// (possibly-empty) halCandidates column regardless of status.
function resultToJson(result) {
  const publication = result.publication;
  return {
    status: result.status,
    rank: publication.rank?.value || 'Unranked',
    year: publication.dblp.year,
    authors: (publication.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed',
    title: dblpTitleText(publication.dblp.title),
    venue: publication.venue || '',
    type: publication.type,
    doi: findDoiUrl(publication.dblp.ee),
    dblpKey: publication.dblp.key,
    matches: (result.matches || []).map(m => ({
      docid: m.halPub.docid,
      year: m.halPub.year,
      authors: (m.halPub.authors || []).map(a => a.name).join(', ') || 'No authors listed',
      title: m.halPub.title,
      venue: m.halPub.venue || '',
      doi: m.halPub.doi ? `https://doi.org/${m.halPub.doi}` : null,
      distance: m.distance ?? null,
    })),
  };
}

// Same missing/to-review split as renderResultsSections, as plain arrays
// instead of Markdown sections.
function resultsToJsonSections(results) {
  return {
    missing: results.filter(r => r.status === 'missing').map(resultToJson),
    toReview: results.filter(r => r.status === 'to-review').map(resultToJson),
  };
}

// CrossCheck.js: one author's own report, no member grouping -- JSON
// counterpart of exportCrossCheckMarkdown above.
export function exportCrossCheckJson({ title, filename, results }) {
  const json = JSON.stringify({ title, ...resultsToJsonSections(results) }, null, 2);
  downloadTextFile(filename, json, 'application/json;charset=utf-8;');
}

// CrossCheckTeam.js/CrossCheckStructure.js: JSON counterpart of
// exportCrossCheckByMemberMarkdown above, same per-member grouping.
export function exportCrossCheckByMemberJson({ title, filename, members, memberLabel }) {
  const json = JSON.stringify({
    title,
    members: members.map(member => ({ member: memberLabel(member), ...resultsToJsonSections(member.results) })),
  }, null, 2);
  downloadTextFile(filename, json, 'application/json;charset=utf-8;');
}

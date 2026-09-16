import { findDoiUrl } from './component/Publications';
import { trimLastDigits } from './utils';
import { orderPublicationsForDisplay, DEFAULT_SORT_MODE } from './rankOrder';

// Client-side only, no backend round trip -- same pattern as CrossCheck.js's
// own CSV export (and, since this file grew a Markdown export for that
// family too -- see exportCrossCheck.js -- the two share this one download
// helper instead of each re-implementing the same Blob/anchor dance).
// Deliberately a lightweight snapshot, not a pixel-perfect mirror of the
// on-screen list: rank shows the raw automatic/override value
// (item.rank?.value) rather than replicating RankBadge's full
// personal/shared-override resolution, and venue is the raw dblp/HAL field
// rather than Venue.js's own acronym-enrichment logic. Good enough for
// "here's my publication list to paste into a CV or a report", not meant to
// replace the page itself.
export function downloadTextFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function rankLabel(item) {
  return item.rank?.value || 'Unranked';
}

// Exported so exportCrossCheck.js's own DBLP row rendering escapes exactly
// the same characters, instead of a second escaper that could quietly drift
// from this one.
export function mdEscape(text) {
  // Just enough to keep a title/venue containing "*"/"_"/"[" from being
  // misread as Markdown syntax -- not a full CommonMark escaper.
  return String(text ?? '').replace(/([*_[\]])/g, '\\$1');
}

function csvEscape(value) {
  const s = value == null ? '' : String(value);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// dblp.js's own <title> shape: either a plain string, or { i, _ } (an
// italicized run followed by the rest) -- see Publications.js's identical
// `title()` helper, which renders the same shape as JSX instead of plain
// text. Exported so exportCrossCheck.js's DBLP row (same underlying record
// shape) renders a title the exact same way.
export function dblpTitleText(o) {
  if (o && typeof o === 'object') return `${o.i || ''}${o._ || ''}`;
  return o || '';
}

// Field extraction, once per source type, shared between the Markdown and
// CSV export below -- a record's year/rank/authors/title/venue/DOI mean the
// exact same thing in both formats, only how the row gets *rendered*
// (Markdown bullet vs CSV columns) differs.
function dblpFields(item) {
  return {
    year: item.dblp.year,
    rank: rankLabel(item),
    authors: (item.authors || []).map(a => trimLastDigits(a._)).join(', ') || 'No authors listed',
    title: dblpTitleText(item.dblp.title),
    venue: item.venue || '',
    type: item.type,
    doiUrl: findDoiUrl(item.dblp.ee),
  };
}

function halFields(item) {
  return {
    year: item.year,
    rank: rankLabel(item),
    authors: (item.authors || []).map(a => a.name).join(', ') || 'No authors listed',
    title: item.title,
    venue: item.venue || '',
    type: item.type,
    doiUrl: item.doi ? `https://doi.org/${item.doi}` : null,
  };
}

// yearOf/rankOf for orderPublicationsForDisplay (rankOrder.js) -- a raw
// export record (unlike Publications.js/HalPublications.js's own {item, nr}
// pair) has no wrapper at all, so these read straight off it.
const DBLP_ACCESSORS = { yearOf: item => item.dblp.year, rankOf: item => item.rank };
const HAL_ACCESSORS = { yearOf: item => item.year, rankOf: item => item.rank };

// Groups/orders `records` exactly the way Publications.js/HalPublications.js
// render them on screen (see rankOrder.js's orderPublicationsForDisplay,
// shared with both) -- so a downloaded file matches whatever sortMode is
// currently active on the page, instead of always being in date order
// regardless of it.
function renderMarkdownBody(records, sortMode, fieldsOf, accessors) {
  const ordered = orderPublicationsForDisplay(records, sortMode, accessors);
  let out = '';
  for (const row of ordered) {
    if (row.kind === 'group') {
      const heading = row.groupKind === 'rankTier' ? row.label : (row.year || 'Unknown year');
      out += `\n## ${heading}\n\n`;
      continue;
    }
    const f = fieldsOf(row.record);
    out += `- **[${f.rank}]** ${mdEscape(f.authors)}. **${mdEscape(f.title)}.** ${mdEscape(f.venue)}${f.doiUrl ? ` [DOI](${f.doiUrl})` : ''}\n`;
  }
  return out;
}

// Flat rows, no literal "section" marker rows -- year and rank are already
// their own columns, so the active grouping is fully recoverable from the
// data itself (and from row order) without a fake row that would sit oddly
// among a spreadsheet's actual data rows.
const CSV_HEADER = ['year', 'rank', 'authors', 'title', 'venue', 'type', 'doi'];

function renderCsvBody(records, sortMode, fieldsOf, accessors) {
  const ordered = orderPublicationsForDisplay(records, sortMode, accessors);
  const rows = [CSV_HEADER];
  for (const row of ordered) {
    if (row.kind !== 'item') continue;
    const f = fieldsOf(row.record);
    rows.push([f.year, f.rank, f.authors, f.title, f.venue, f.type, f.doiUrl || '']);
  }
  return rows.map(row => row.map(csvEscape).join(',')).join('\r\n');
}

// Same ordering as renderMarkdownBody/renderCsvBody, flattened to just the
// items (no group-heading rows -- year/rank are already their own fields,
// same reasoning as CSV_HEADER above) and run through the same fieldsOf as
// both other formats, so a JSON export never drifts from what the
// Markdown/CSV ones show for the same record.
function jsonPublications(records, sortMode, fieldsOf, accessors) {
  const ordered = orderPublicationsForDisplay(records, sortMode, accessors);
  return ordered
    .filter(row => row.kind === 'item')
    .map(row => {
      const f = fieldsOf(row.record);
      return { year: f.year, rank: f.rank, authors: f.authors, title: f.title, venue: f.venue, type: f.type, doi: f.doiUrl };
    });
}

// records: the same array Publications.js renders.
export function exportDblpPublicationsMarkdown(records, { title, filename, sortMode = DEFAULT_SORT_MODE }) {
  const body = renderMarkdownBody(records, sortMode, dblpFields, DBLP_ACCESSORS);
  downloadTextFile(filename, `# ${title}\n${body}`, 'text/markdown;charset=utf-8;');
}

export function exportDblpPublicationsCsv(records, { filename, sortMode = DEFAULT_SORT_MODE }) {
  const csv = renderCsvBody(records, sortMode, dblpFields, DBLP_ACCESSORS);
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
}

export function exportDblpPublicationsJson(records, { title, filename, sortMode = DEFAULT_SORT_MODE }) {
  const json = JSON.stringify({ title, publications: jsonPublications(records, sortMode, dblpFields, DBLP_ACCESSORS) }, null, 2);
  downloadTextFile(filename, json, 'application/json;charset=utf-8;');
}

// records: the same array HalPublications.js renders.
export function exportHalPublicationsMarkdown(records, { title, filename, sortMode = DEFAULT_SORT_MODE }) {
  const body = renderMarkdownBody(records, sortMode, halFields, HAL_ACCESSORS);
  downloadTextFile(filename, `# ${title}\n${body}`, 'text/markdown;charset=utf-8;');
}

export function exportHalPublicationsCsv(records, { filename, sortMode = DEFAULT_SORT_MODE }) {
  const csv = renderCsvBody(records, sortMode, halFields, HAL_ACCESSORS);
  downloadTextFile(filename, csv, 'text/csv;charset=utf-8;');
}

export function exportHalPublicationsJson(records, { title, filename, sortMode = DEFAULT_SORT_MODE }) {
  const json = JSON.stringify({ title, publications: jsonPublications(records, sortMode, halFields, HAL_ACCESSORS) }, null, 2);
  downloadTextFile(filename, json, 'application/json;charset=utf-8;');
}

import { dblpCategories } from './dblp';

// Colors are borrowed from the matching dblp category (via cssClass) so HAL
// and DBLP stats charts use a consistent palette for the same kind of work.
//
// This list is every docType_s HAL's own search API currently returns at
// least one document for (checked against its docType_s facet across the
// whole corpus, ~4.6M docs, Sept. 2026) -- not just the handful this app
// happened to encounter first. HAL adds new ones over time, so getHalCategory
// below still has a safe fallback for a genuinely new one, but this covers
// every kind actually in use today instead of silently falling back to a
// generic "Other" for anything less common than an article/conference paper.
const halCategoriesRaw = {
  'ART': { name: 'Journal article', cssClass: 'article' },
  'COMM': { name: 'Conference paper', cssClass: 'inproceedings' },
  'COUV': { name: 'Book section', cssClass: 'incollection' },
  'OUV': { name: 'Book', cssClass: 'book' },
  'THESE': { name: 'Thesis', cssClass: 'book' },
  'HDR': { name: 'Habilitation', cssClass: 'book' },
  'MEM': { name: 'Master’s/other dissertation', cssClass: 'book' },
  'MEMLIC': { name: 'Bachelor’s dissertation', cssClass: 'book' },
  'ETABTHESE': { name: 'Thesis progress report', cssClass: 'informal' },
  'REPORT': { name: 'Report', cssClass: 'informal' },
  'REPORT_LABO': { name: 'Lab report', cssClass: 'informal' },
  'REPORT_MAST': { name: 'Internship report (Master’s)', cssClass: 'informal' },
  'REPORT_LICE': { name: 'Internship report (Bachelor’s)', cssClass: 'informal' },
  'REPORT_DOCT': { name: 'Internship report (Doctoral)', cssClass: 'informal' },
  'REPORT_ETAB': { name: 'Institutional report', cssClass: 'informal' },
  'REPORT_FORM': { name: 'Training report', cssClass: 'informal' },
  'REPORT_GMAST': { name: 'Internship report (Engineering Master’s)', cssClass: 'informal' },
  'REPORT_GLICE': { name: 'Internship report (Engineering Bachelor’s)', cssClass: 'informal' },
  'REPORT_FPROJ': { name: 'Final-year project report', cssClass: 'informal' },
  'REPORT_RFOINT': { name: 'Internal training report', cssClass: 'informal' },
  'REPORT_COOR': { name: 'Coordination report', cssClass: 'informal' },
  'REPORT_RETABINT': { name: 'Internal institutional report', cssClass: 'informal' },
  'CREPORT': { name: 'Confidential report', cssClass: 'informal' },
  'REPACT': { name: 'Activity report', cssClass: 'informal' },
  'SYNTHESE': { name: 'Summary report', cssClass: 'informal' },
  'NOTE': { name: 'Note', cssClass: 'informal' },
  'NOTICE': { name: 'Bibliographic notice', cssClass: 'informal' },
  'POSTER': { name: 'Poster', cssClass: 'informal' },
  // Not 'inproceedings' -- that bucket is conference/workshop *papers* only
  // (matches a real proceedings entry); a PRESCONF is just a presentation
  // with nothing published, so it belongs with reports/posters/etc. instead.
  // Consistent with it not being rankable either -- see the removed
  // isHalConferenceType (git history) this used to require.
  'PRESCONF': { name: 'Conference presentation', cssClass: 'informal' },
  'PATENT': { name: 'Patent', cssClass: 'informal' },
  'PROCEEDINGS': { name: 'Proceedings', cssClass: 'proceedings' },
  'LECTURE': { name: 'Lecture', cssClass: 'informal' },
  'BLOG': { name: 'Blog post', cssClass: 'informal' },
  'TRAD': { name: 'Translation', cssClass: 'informal' },
  'IMG': { name: 'Image', cssClass: 'informal' },
  'VIDEO': { name: 'Video', cssClass: 'informal' },
  'SON': { name: 'Audio recording', cssClass: 'informal' },
  'MAP': { name: 'Map', cssClass: 'informal' },
  'OTHER': { name: 'Other', cssClass: 'informal' },
  'UNDEFINED': { name: 'Other', cssClass: 'informal' },
  'SOFTWARE': { name: 'Software', cssClass: 'software' },
  'ISSUE': { name: 'Journal issue', cssClass: 'informal' },
};

// letter (alongside color) is likewise borrowed from the matching dblp
// category -- e.g. HAL's ART/COUV/... all become 'j'/'p'/... the same way
// dblp's own 'article'/'incollection'/... do, so a HAL publication's row
// number (see HalPublications.js) reads the same as a dblp one of the same
// kind instead of using a separate lettering scheme.
export const halCategories = Object.fromEntries(
  Object.entries(halCategoriesRaw).map(([key, value]) => [
    key,
    { ...value, color: dblpCategories[value.cssClass].color, letter: dblpCategories[value.cssClass].letter },
  ])
);

// Falls back to the 'informal' bucket -- fully formed (letter/color
// included, not just cssClass) so a HAL docType we don't know about yet
// (there's no closed list of these -- HAL adds new ones over time) still
// gets a real tag/number instead of "NaN" (letter undefined) the way
// SOFTWARE/ISSUE did before they got their own entries above.
export function getHalCategory(type) {
  return halCategories[type] || { ...halCategories.UNDEFINED, name: type || 'Other' };
}

export async function searchAuthor(query) {
  const resp = await fetch(`/api/hal/search/${query}`);
  return await resp.json();
}

// { idHal, orcid } -- orcid is null when this HAL identity hasn't linked
// one (see api/src/hal.js's getAuthorInfo for why this isn't derived from
// the publication list itself).
export async function fetchAuthorInfo(idHal) {
  const resp = await fetch(`/api/hal/author-info/${idHal}`);
  return await resp.json();
}

// Batch counterpart of fetchAuthorInfo, for member lists (Structure.js/
// Team.js) that need ORCIDs for potentially hundreds of idHals in one round
// trip. Returns idHal -> { name, orcid } -- same shape/convention as
// fetchAuthorInfo above (orcid bare), so OrcidLine.js renders either the
// same way.
export async function fetchAuthorInfos(idHals) {
  if (idHals.length === 0) return {};
  const resp = await fetch('/api/hal/author-infos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ idHals }),
  });
  return await resp.json();
}

// A HAL "structure" (lab, institution, team...) -- see
// https://aurehal.archives-ouvertes.fr/structure/index -- searched the same
// way as an author, but every publication it's ever been affiliated with
// gets pulled directly rather than needing a curated list of members.
export async function searchStructure(query) {
  const resp = await fetch(`/api/hal/structure-search/${query}`);
  return await resp.json();
}

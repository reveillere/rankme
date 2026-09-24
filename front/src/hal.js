import { dblpCategories } from './dblp';

// Colors are borrowed from the matching dblp category (via cssClass) so HAL
// and DBLP stats charts use a consistent palette for the same kind of work.
const halCategoriesRaw = {
  'ART': { name: 'Journal article', cssClass: 'article' },
  'COMM': { name: 'Conference paper', cssClass: 'inproceedings' },
  'COUV': { name: 'Book section', cssClass: 'incollection' },
  'OUV': { name: 'Book', cssClass: 'book' },
  'THESE': { name: 'Thesis', cssClass: 'book' },
  'HDR': { name: 'Habilitation', cssClass: 'book' },
  'REPORT': { name: 'Report', cssClass: 'informal' },
  'POSTER': { name: 'Poster', cssClass: 'informal' },
  'PATENT': { name: 'Patent', cssClass: 'informal' },
  'PROCEEDINGS': { name: 'Proceedings', cssClass: 'proceedings' },
  'LECTURE': { name: 'Lecture', cssClass: 'informal' },
  'UNDEFINED': { name: 'Other', cssClass: 'informal' },
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

export function getHalCategory(type) {
  return halCategories[type] || { name: type || 'Other', cssClass: 'informal' };
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

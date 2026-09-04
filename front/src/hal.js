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

export const halCategories = Object.fromEntries(
  Object.entries(halCategoriesRaw).map(([key, value]) => [
    key,
    { ...value, color: dblpCategories[value.cssClass].color },
  ])
);

export function getHalCategory(type) {
  return halCategories[type] || { name: type || 'Other', cssClass: 'informal' };
}

export async function searchAuthor(query) {
  const resp = await fetch(`/api/hal/search/${query}`);
  return await resp.json();
}

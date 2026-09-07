// Shared by the dblp (Author.js) and HAL (AuthorHal.js) publication views —
// kept as a pure function so it can be unit-tested without any React/DOM
// setup, and so the two views can't drift out of sync with each other.
//
// categoryKeyAccessor: maps a publication to one of the 6 shared category
// keys (see FilterSettingsContext's `categories`) — defaults to the raw
// `.type`, which is already correct for dblp publications; HAL callers pass
// `pub => getHalCategory(pub.type).cssClass` since HAL's own type codes
// (ART, COMM, ...) aren't the shared vocabulary.
export function filterPublications(publications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor = pub => pub.type, filterRanks }) {
  return publications
    .filter(pub => {
      const year = yearAccessor(pub);
      return year == null || (year >= filterYears[0] && year <= filterYears[1]);
    })
    .filter(pub => filterCategories[categoryKeyAccessor(pub)])
    .filter(pub => pub.rank ? filterRanks[pub.rank.value] : true);
}

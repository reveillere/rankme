// Shared by the dblp (Author.js) and HAL (AuthorHal.js) publication views —
// kept as a pure function so it can be unit-tested without any React/DOM
// setup, and so the two views can't drift out of sync with each other.
export function filterPublications(publications, { yearAccessor, filterYears, filterCategories, filterRanks }) {
  return publications
    .filter(pub => {
      const year = yearAccessor(pub);
      return year == null || (year >= filterYears[0] && year <= filterYears[1]);
    })
    .filter(pub => filterCategories[pub.type])
    .filter(pub => pub.rank ? filterRanks[pub.rank.value] : true);
}

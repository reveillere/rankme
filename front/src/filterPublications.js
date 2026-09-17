// Shared by the dblp (Author.js) and HAL (AuthorHal.js) publication views —
// kept as a pure function so it can be unit-tested without any React/DOM
// setup, and so the two views can't drift out of sync with each other.
//
// categoryKeyAccessor: maps a publication to one of the 6 shared category
// keys (see FilterSettingsContext's `categories`) — defaults to the raw
// `.type`, which is already correct for dblp publications; HAL callers pass
// `pub => getHalCategory(pub.type).cssClass` since HAL's own type codes
// (ART, COMM, ...) aren't the shared vocabulary.
//
// The "Only show matches to review" toggle (see e.g. Author.js) is applied
// separately by the caller, not here -- it also needs the pre-review count
// (to hide the toggle when there's nothing to review), so there was going
// to be a second pass over this same list either way.
//
// effectiveValueAccessor: what to check a filterRanks checkbox against,
// instead of pub.rank.value straight off the automatic match -- defaults to
// exactly that (pub => pub.rank?.value) only for a caller that doesn't pass
// one at all. Both real callers (Author.js/AuthorHal.js) pass one built from
// customRankings.js's own getDisplayValue, so a filter checkbox always
// matches exactly what RankBadge.js shows for that publication: personal
// override/community correction when no custom ranking is active on that
// axis, the custom ranking's own entry when one is (customRankings.js's
// customProfileIdForPortal) -- this used to fall back to the raw automatic
// value whenever no custom ranking was active, silently ignoring a
// personal/community correction; fixed so the two can no longer drift.
export function filterPublications(publications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor = pub => pub.type, filterRanks, effectiveValueAccessor = pub => pub.rank?.value }) {
  return publications
    .filter(pub => {
      const year = yearAccessor(pub);
      return year == null || (year >= filterYears[0] && year <= filterYears[1]);
    })
    .filter(pub => filterCategories[categoryKeyAccessor(pub)])
    .filter(pub => pub.rank ? filterRanks[effectiveValueAccessor(pub)] : true);
}

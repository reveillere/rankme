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
// exactly that (pub => pub.rank?.value), so every existing caller keeps
// today's behavior byte for byte, including its known pre-existing quirk
// (a personal/community match correction already isn't reflected here,
// unlike RanksByYearChart/RankSummary's own getEffectiveValue -- out of
// scope to fix generally, see the implementation plan's own "risques"
// section). A caller with a custom ranking active on either axis passes one
// that substitutes the custom value only for records on an axis that
// actually has a profile active (customRankings.js's
// getDisplayValue/customProfileIdForPortal) -- otherwise a filter checkbox
// for a custom letter nobody assigned yet would just never match anything.
export function filterPublications(publications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor = pub => pub.type, filterRanks, effectiveValueAccessor = pub => pub.rank?.value }) {
  return publications
    .filter(pub => {
      const year = yearAccessor(pub);
      return year == null || (year >= filterYears[0] && year <= filterYears[1]);
    })
    .filter(pub => filterCategories[categoryKeyAccessor(pub)])
    .filter(pub => pub.rank ? filterRanks[effectiveValueAccessor(pub)] : true);
}

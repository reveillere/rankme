import { getOverride, portalFromRank } from '../matchOverrides';
import { getDisplayValue } from '../customRankings';

// Read-only count breakdown shown beside the ranks-by-year chart. Category
// and rank selection now live in the global settings dialog, so the author
// page only needs to report what the chart is already showing, not let the
// user toggle it again here.
//
// sharedMaps: see RanksByYearChart's identical comment in Statistics.js --
// counts here follow the same corrected value the chart and the badge next
// to each record already show, not the raw automatic match.
// customProfileIdAccessor(record) -> profileId|null: which axis a record
// belongs to (conference/journal) can no longer be derived from
// portalFromRank(record.rank) the way portal itself still can -- a
// CCF-*referenced* custom profile means a CCF-sourced rank no longer
// implies "no custom profile is active here" (see customRankings.js's
// createProfile/getEffectiveCustomValue). Each container already has to
// resolve this correctly for its own effectiveValueAccessor (filterPublications'
// filter checkboxes) via its own type-based portalAccessor -- pass that
// same resolution in here instead of re-deriving it from the rank's
// resolved portal, which is exactly what was wrong before. portalFromRank
// is still right for the sharedMaps/getOverride lookups below: those
// genuinely want whichever portal ('core'/'sjr'/'ccf') the rank actually
// resolved to, not which axis it's on.
export function RankSummary({ records, ranks, selected, sharedMaps, customProfileIdAccessor, yearAccessor }) {
  const activeRanks = Object.entries(ranks).filter(([key]) => selected[key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '160px' }}>
      {activeRanks.map(([key, value]) => {
        const count = records.filter(record => {
          const portal = portalFromRank(record.rank);
          const customProfileId = customProfileIdAccessor?.(record) ?? null;
          const override = getOverride(portal, record.rank);
          return getDisplayValue(record.rank, { portal, sharedMap: sharedMaps?.[portal], customProfileId, override, year: yearAccessor?.(record) }) === key;
        }).length;
        return (
          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span style={{ width: '12px', height: '12px', borderRadius: '2px', backgroundColor: value.color, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{value.name}</span>
            <span style={{ color: 'gray', fontVariantNumeric: 'tabular-nums' }}>{count}</span>
          </div>
        );
      })}
    </div>
  );
}

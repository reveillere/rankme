// Read-only count breakdown shown beside the ranks-by-year chart. Category
// and rank selection now live in the global settings dialog, so the author
// page only needs to report what the chart is already showing, not let the
// user toggle it again here.
export function RankSummary({ records, ranks, selected }) {
  const activeRanks = Object.entries(ranks).filter(([key]) => selected[key]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '160px' }}>
      {activeRanks.map(([key, value]) => {
        const count = records.filter(record => record.rank?.value === key).length;
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

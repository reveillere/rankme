import { Bar } from 'react-chartjs-2';
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';
import { getOverride, portalFromRank } from '../matchOverrides';
import { getDisplayValue } from '../customRankings';

// Registered here (rather than by each page that renders a chart) so it
// happens exactly once, wherever this module is first loaded -- Author.js
// and Team.js used to each do this themselves at import time, which is why
// this file is now the one and only place chart.js's core gets pulled in.
Chart.register(ArcElement, LinearScale, BarController, BarElement, CategoryScale, Tooltip);

function ByYearChart({ records, selected, fieldAccessor, labelAccessor, colorAccessor, yearAccessor }) {
  const options = {
    responsive: false,
    scales: {
      y: {
        stacked: true,
        beginAtZero: true,
        ticks: {
          stepSize: 1,
          precision: 0,
          callback: function (value) {
            if (Math.floor(value) === value) {
              return value;
            }
          },
        },
      },
      x: {
        stacked: true,
      },
    },
    options: {
      tooltips: {
        enabled: true
      },
    },
  };

  const recordsWithYear = records.filter(record => yearAccessor(record) != null);
  const [startYear, endYear] = recordsWithYear.reduce(([min, max], record) => {
    const year = yearAccessor(record);
    return [Math.min(min, year), Math.max(max, year)];
  }, [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);
  const dataByYear = {};

  const labels = Array.from({ length: endYear - startYear + 1 }, (_, i) => (i + startYear).toString());

  for (let year = startYear; year <= endYear; year++) {
    dataByYear[year] = {};
  }

  for (let pub of recordsWithYear) {
    const year = yearAccessor(pub);

    if (selected[fieldAccessor(pub)]) {
      dataByYear[year][fieldAccessor(pub)] = (dataByYear[year][fieldAccessor(pub)] || 0) + 1;
    }
  }

  const datasets = Object.keys(selected).filter(key => selected[key]).map(key => ({
    label: labelAccessor(key),
    data: labels.map(year => dataByYear[year][key] || 0),
    backgroundColor: colorAccessor(key),
  }));

  const data = {
    labels,
    datasets,
  };

  return <Bar data={data} options={options} />;

}

// sharedMaps: same { core, sjr } (ccf has no community overrides yet, see
// RankBadge.js) map RankBadge.js itself reads from, threaded down from the
// container's one useSharedOverridesMaps() call -- so a personal or
// community correction changes which bucket a publication counts under
// here too, not just the badge shown next to it in the list below.
// customProfileIdAccessor(pub) -> profileId|null: see RankSummary.js's
// identical comment -- portalFromRank(pub.rank) can no longer double as
// "which axis is this" now that a CCF-*referenced* custom profile means a
// CCF-sourced rank doesn't imply "no custom profile active" the way it used
// to. Each container passes its own type-based resolution (the same one
// effectiveValueAccessor already uses for filterPublications) instead.
// portalFromRank is still right for sharedMaps/getOverride below, which
// genuinely want the rank's own resolved portal.
export function RanksByYearChart({ records, selected, ranks, yearAccessor, sharedMaps, customProfileIdAccessor }) {
  return (
    <ByYearChart
      records={records}
      selected={selected}
      fieldAccessor={(pub) => {
        const portal = portalFromRank(pub.rank);
        const customProfileId = customProfileIdAccessor?.(pub) ?? null;
        const override = getOverride(portal, pub.rank);
        return getDisplayValue(pub.rank, { portal, sharedMap: sharedMaps?.[portal], customProfileId, override, year: yearAccessor(pub) });
      }}
      labelAccessor={(key) => ranks[key].name}
      colorAccessor={(key) => ranks[key].color}
      yearAccessor={yearAccessor}
    />
  );
}

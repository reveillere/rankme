import { Bar } from 'react-chartjs-2';

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

  const datasets = Object.keys(selected).map(key => ({
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

export function RanksByYearChart({ records, selected, ranks, yearAccessor }) {
  return (
    <ByYearChart
      records={records}
      selected={selected}
      fieldAccessor={(pub) => pub.rank?.value}
      labelAccessor={(key) => ranks[key].name}
      colorAccessor={(key) => ranks[key].color}
      yearAccessor={yearAccessor}
    />
  );
}

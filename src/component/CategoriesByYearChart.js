import { Bar } from 'react-chartjs-2';
import { dblpCategories } from '../dblp';




function CategoriesByYearChart({ records, selectedCategories }) {
  const [startYear, endYear] = records.reduce(([min, max], record) => {
    const year = record.dblp.year;
    return [Math.min(min, year), Math.max(max, year)];
  }, [Number.MAX_SAFE_INTEGER, Number.MIN_SAFE_INTEGER]);
  const dataByYear = {};

  const labels = Array.from({ length: endYear - startYear + 1 }, (_, i) => (i + startYear).toString());

  for (let year = startYear; year <= endYear; year++) {
    dataByYear[year] = {};
  }
  
  for (let pub of records) {
    const year = pub.dblp.year;
    const type = pub.type;

    if (selectedCategories[type]) {
      dataByYear[year][type] = (dataByYear[year][type] || 0) + 1;
    }
  }

  const datasets = Object.keys(selectedCategories).map(category => ({
    label: dblpCategories[category].name,
    data: labels.map(year => dataByYear[year][category] || 0),
    backgroundColor: dblpCategories[category].color,
  }));

  const data = {
    labels,
    datasets,
  };

  const options = {
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
  
  return <Bar data={data} options={options} />;
  
}

export default CategoriesByYearChart;  
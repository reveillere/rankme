import { Bar, Pie } from 'react-chartjs-2';
import { dblpCategories } from '../dblp';
import corePortal from '../corePortal';



function PieChart({ records, selected, fieldAccessor, labelAccessor, colorAccessor }) {
  const options = {
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 2,
    plugins: {
      tooltip: {
        enabled: true
      },
      legend: {
        display: false,
      }
    }
  };
  
  const selectedKeys = Object.keys(selected);
  
  const datas = {
    labels: selectedKeys.map(key => labelAccessor(key)),
    datasets: [
      {
        data: selectedKeys.map(key => records.filter(record => fieldAccessor(record) === key).length),
        backgroundColor: selectedKeys.map(key => colorAccessor(key)),
        borderColor: selectedKeys.map(key => colorAccessor(key)),
        borderWidth: 1,
      },
    ],
  };
  

  return <Pie options={options} data={datas} />;
}

export function CategoriesPieChart({ records, selected }) {
  return (
    <PieChart 
      records={records} 
      selected={selected} 
      fieldAccessor={(pub) => pub.type}
      labelAccessor={(key) => dblpCategories[key].name} 
      colorAccessor={(key) => dblpCategories[key].color}
    />
  );
}

export function RanksPieChart({ records, selected }) {
  return (
    <PieChart 
      records={records} 
      selected={selected} 
      fieldAccessor={(pub) => pub.rank?.value}
      labelAccessor={(key) => corePortal.ranks[key].name} 
      colorAccessor={(key) => corePortal.ranks[key].color}
    />
  );
}




function ByYearChart({ records, selected, fieldAccessor, labelAccessor, colorAccessor }) {
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


export function CategoriesByYearChart({ records, selected }) {
  return (
    <ByYearChart
      records={records}
      selected={selected}
      fieldAccessor={(pub) => pub.type}
      labelAccessor={(key) => dblpCategories[key].name} 
      colorAccessor={(key) => dblpCategories[key].color}
    />
  );
}

export function RanksByYearChart({ records, selected }) {
  return (
    <ByYearChart
      records={records}
      selected={selected}
      fieldAccessor={(pub) => pub.rank?.value}
      labelAccessor={(key) => corePortal.ranks[key].name} 
      colorAccessor={(key) => corePortal.ranks[key].color}
    />
  );
}

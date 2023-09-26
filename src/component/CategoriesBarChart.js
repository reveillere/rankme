import React from 'react';
import { Bar } from 'react-chartjs-2';
import { dblpCategories } from './dblp';


function CategoriesBarChart({ publications, selectedCategories, range }) {
  const [startYear, endYear] = range;
  const dataByYear = {};

  // Filter publications based on the selected range
  const filteredPublications = publications.filter(pub => pub.dblp.year >= startYear && pub.dblp.year <= endYear);

  filteredPublications.forEach(pub => {
    const year = pub.dblp.year;
    const type = pub.type;

    if (!dataByYear[year]) {
      dataByYear[year] = {};
    }

    if (selectedCategories[type]) {
      dataByYear[year][type] = (dataByYear[year][type] || 0) + 1;
    }
  });

  const labels = Object.keys(dataByYear).sort();
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
    plugins: {
      tooltip: {
        enabled: true,
      },
    },
  };
  
  return <Bar data={data} options={options} />;
  
}

export default CategoriesBarChart;  
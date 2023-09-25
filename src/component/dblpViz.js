import { dblpCategories } from './dblp';
import { useState, useEffect } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css'
import DateRangeSlider from './DateRangeSlider';
import React from 'react';
import { Checkbox, FormGroup, FormControlLabel, Tab, Tabs } from '@mui/material';
import { Publications } from './PubList';


function calculatePublicationsByType(publications) {
  const publicationsByType = Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: 0 }), {});



  // Parcourez les publications et agrégez-les par type
  publications.forEach(publication => {
    const type = publication.type;
    if (type in publicationsByType) {
      publicationsByType[type]++;
    } else {
      console.log('DEBUG : type not found : ', type);
    }
  }
  );
  return publicationsByType;
}



export function PublicationsViz({ authorName, publications }) {
  const [publicationsByType, setPublicationsByType] = useState(null);
  const [startYear, setStartYear] = useState(0);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [range, setRange] = React.useState([minYear, maxYear]);
  const [tabValue, setTabValue] = useState(0);

  const [categorySelected, setCategorySelected] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));

  useEffect(() => {
    const fetchData = async () => {
      setStartYear(minYear);
      setPublicationsByType(calculatePublicationsByType(publications));
    }
    fetchData();
  }, [publications]);

  useEffect(() => {
    if (publications) {
      const publis = publications.filter(pub => pub.dblp.year >= range[0] && pub.dblp.year <= range[1]);
      setPublicationsByType(calculatePublicationsByType(publis));
    }
  }, [publications, range]);

  if (!publicationsByType) return <div>Chargement...</div>;



  const data = {
    labels: Object.keys(dblpCategories)
      .filter(key => categorySelected[key])
      .map(key => dblpCategories[key].name),
    datasets: [
      {
        data: Object.keys(dblpCategories)
          .filter(key => categorySelected[key])
          .map(key => publicationsByType[key] || 0),
        backgroundColor: Object.keys(dblpCategories)
          .filter(key => categorySelected[key])
          .map(key => dblpCategories[key].color),
        borderColor: Object.keys(dblpCategories)
          .filter(key => categorySelected[key])
          .map(key => dblpCategories[key].color),
        borderWidth: 1,
      },
    ],
  };


  const pieOptions = {
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

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const publicationsShown = Object.keys(publicationsByType)
    .filter(key => categorySelected[key])
    .reduce((acc, key) => acc + publicationsByType[key], 0);



  return (
    <div className='App'>
      <h1>Records of {authorName}</h1>
      <div style={{ fontSize: 'large' }}>
        {publicationsShown === 0 ? 'No record found' : publicationsShown === publications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${publications.length} records in the period of ${range[1] - range[0] + 1} years`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0' }}>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
            <Tab label="Stats by type" />
            <Tab label="Stats by year" />
          </Tabs>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {tabValue === 0 && <Pie options={pieOptions} data={data} />}
            {tabValue === 1 && <BarChart publications={publications} selectedCategories={categorySelected} range={range} />}
          </div>
        </div>
        <div style={{ width: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: '100px', marginTop: '50px' }}>
          <CategoriesSelector publicationsByType={publicationsByType} selected={categorySelected} setSelected={setCategorySelected} />
        </div>
      </div>
      <DateRangeSlider minYear={minYear} maxYear={maxYear} range={range} setRange={setRange} />
      <div style={{ height: '50px' }}></div>
      <Publications data={publications} />
    </div>

  );
}




function CategoriesSelector({ publicationsByType, selected, setSelected }) {

  const handleSelectAll = () => {
    const allSelected = {};
    Object.keys(selected).forEach(key => {
      allSelected[key] = true;
    });
    setSelected(allSelected);
  };

  const handleUnselectAll = () => {
    const noneSelected = {};
    Object.keys(selected).forEach(key => {
      noneSelected[key] = false;
    });
    setSelected(noneSelected);
  };

  return (
    <FormGroup style={{ margin: 0, padding: 0 }}>
      {Object.entries(dblpCategories).map(([key, value]) => (
        <div
          key={key}
          style={{ marginBottom: '-14px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={selected[key] || false}
                size="small"
                name={key}
                style={{ color: value.color }}
              />}
            label={`${value.name} (${publicationsByType[key] || 0})`}
            onChange={() => setSelected({ ...selected, [key]: !selected[key] })}
            style={{ margin: 0, width: '400px', fontSize: '0.8rem' }}
          />
        </div>
      ))}
      <div style={{ marginTop: '10px', marginLeft: '10px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); handleSelectAll(e); }} style={{ marginRight: '10px', cursor: 'pointer', textDecoration: 'underline' }}>select all</a>
        |
        <a href="#" onClick={(e) => { e.preventDefault(); handleUnselectAll(e); }} style={{ marginLeft: '10px', cursor: 'pointer', textDecoration: 'underline' }}>deselect all</a>
      </div>
    </FormGroup>
  );
}


function BarChart({ publications, selectedCategories, range }) {
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




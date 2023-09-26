import { dblpCategories } from './dblp';
import { useState, useEffect } from 'react';
import { Bar, Pie } from 'react-chartjs-2';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css'
import DateRangeSlider from './DateRangeSlider';
import React from 'react';
import { Checkbox, FormGroup, FormControlLabel, Tab, Tabs } from '@mui/material';
import { Publications } from './PubList';
import CategoriesBarChart from './CategoriesBarChart';
import CategoriesSelector from './CategoriesSelector';
import YearPieChart from './YearPieChart';


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
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
  const [tabValue, setTabValue] = useState(0);
  const [filterCategories, setFilterCategories] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
  const [filteredRecords, setFilteredRecords] = useState(publications);

  useEffect(() => {
    const fetchData = async () => {
      setStartYear(minYear);
      setPublicationsByType(calculatePublicationsByType(publications));
    }
    fetchData();
  }, [publications]);

  useEffect(() => {
    if (publications) {
      const publis = publications.filter(pub => pub.dblp.year >= filterYears[0] && pub.dblp.year <= filterYears[1]);
      setPublicationsByType(calculatePublicationsByType(publis));

      setFilteredRecords(publis.filter(pub => filterCategories[pub.type]));
    }
  }, [publications, filterYears, filterCategories]);

  if (!publicationsByType) return <div>Chargement...</div>;

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const publicationsShown = filteredRecords.length;


  return (
    <div className='App'>
      <h1>Records of {authorName}</h1>
      <div style={{ fontSize: 'large' }}>
        {publicationsShown === 0 ? 'No record found' : publicationsShown === publications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${publications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0' }}>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Tabs value={tabValue} onChange={handleTabChange} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
            <Tab label="Stats by type" />
            <Tab label="Stats by year" />
          </Tabs>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {tabValue === 0 && <YearPieChart records={filteredRecords} />}
            {tabValue === 1 && <CategoriesBarChart publications={publications} selectedCategories={filterCategories} range={filterYears} />}
          </div>
        </div>
        <div style={{ width: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center', marginLeft: '100px', marginTop: '50px' }}>
          <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} />
        </div>
      </div>
      <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />
      <div style={{ height: '50px' }}></div>
      <Publications data={filteredRecords} />
    </div>

  );
}







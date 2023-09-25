import { dblpCategories } from './dblp';
import { useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css'
import DateRangeSlider from './DateRangeSlider';
import React from 'react';
import { Checkbox, Grid, FormGroup, FormControlLabel } from '@mui/material';


const pieOptions = {
  responsive: true,
  maintainAspectRatio: true,
  aspectRatio: 2,
  plugins: {
    legend: {
      display: false,
      position: 'right'
    }
  }
};


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



export function PublicationsViz({ publications }) {
  const [publicationsByType, setPublicationsByType] = useState(null);
  const [startYear, setStartYear] = useState(0);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [range, setRange] = React.useState([minYear, maxYear]);

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



  const data =  {
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
  





  return (
    <div className='App'>
      <div style={{ fontWeight: 800, fontSize: 'large' }}>
        Total of {Object.values(publicationsByType).reduce((acc, val) => acc + val, 0)} publications in the period !
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '40px 0' }}>
        <div style={{ width: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div>
            <Pie options={pieOptions} data={data} />
          </div>
        </div>
        <div style={{ width: '50%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <CategoriesSelector categorySelected={categorySelected} setCategorySelected={setCategorySelected} />
        </div>
      </div>
      <DateRangeSlider minYear={minYear} maxYear={maxYear} range={range} setRange={setRange} />
    </div>
  );
}




function CategoriesSelector({ categorySelected, setCategorySelected }) {

  const handleLineClick = (name) => {
    return (event) => {
      setCategorySelected(prevCategorySelected => {
        return { ...prevCategorySelected, [name]: event.target.checked };
      });
    };
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
                defaultChecked
                size="small"
                name={key}
                style={{ color: value.color }}
              />}
            label={value.name}
            onChange={handleLineClick(key)}
            style={{ margin: 0 }}
          />
        </div>
      ))}
    </FormGroup>
  );
}


import { dblpCategories } from './dblp';
import { useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css'
import DateRangeSlider from './DateRangeSlider';
import React from 'react';

const pieOptions = {
  responsive: true,
  maintainAspectRatio: true,  // This ensures the chart maintains its aspect ratio
  aspectRatio: 1,             // Default is 2, reduce this to make the pie smaller
  plugins: {
    legend: {
      display: true,
      position: 'right'  // This will place the legend on the right
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
  const [publicationsByType, setPublicationsByType] = useState(null); // State to store fetched data
  const [startYear, setStartYear] = useState(0);
  const [endYear, setEndYear] = useState(new Date().getFullYear());
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [range, setRange] = React.useState([minYear, maxYear]);


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


  const colors = Object.values(dblpCategories).map(category => category.color);
  const data = {
    labels: Object.values(dblpCategories).map(category => category.name),
    datasets: [
      {
        data: Object.values(publicationsByType),
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
      },
    ],
  };


  
  return (
    <div className='App'>
      <div style={{ fontWeight: 800, fontSize: 'large' }}>
      Total of {Object.values(publicationsByType).reduce((acc, val) => acc + val, 0)} publications in the period !
      </div>
      <div style={{ width: '300px', margin: 'auto' }}>
        <Pie options={pieOptions} data={data} />
      </div>
      
       <DateRangeSlider minYear={minYear} maxYear={maxYear} range={range} setRange={setRange} />
    </div>
  );
}


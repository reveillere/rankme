import { dblpCategories } from './dblp';
import { useState, useEffect } from 'react';
import { Pie } from 'react-chartjs-2';
import DatePicker from 'react-datepicker';
import 'react-datepicker/dist/react-datepicker.css';


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
  
  useEffect(() => {
    const fetchData = async () => {
      setStartYear(Math.min(...publications.map(pub => pub.dblp.year)));
      setPublicationsByType(calculatePublicationsByType(publications));
    }
    fetchData();
  }, [publications]);

  useEffect(() => {
    if (publications) {
      const publis = publications.filter(pub => pub.dblp.year >= startYear && pub.dblp.year <= endYear);
      setPublicationsByType(calculatePublicationsByType(publis));
    }
  }, [publications, startYear, endYear]);

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
  

  console.log('DEBUG : publicationsByType : ', publicationsByType);

  return (
    <div>
      Total of {Object.values(publicationsByType).reduce((acc, val) => acc + val, 0) } publications in the period !
      <div style={{  width: '300px', margin: '20px auto' }}>
        <Pie options={pieOptions} data={data} />
      </div>
      <YearPickerChart startYear={startYear} setStartYear={setStartYear} endYear={endYear} setEndYear={setEndYear} />
    </div>
  );
}




export function YearPickerChart({ startYear, setStartYear, setEndYear, endYear } ) {
  
    const years = [];
    for (let year = startYear; year <= endYear; year++) {
      years.push(year);
    }

    return (
        <div>
            <div>
                Filter dates from : 
                <DatePicker
                    selected={new Date(startYear, 0, 1)}
                    onChange={(date) => date && setStartYear(date.getFullYear())}
                    dateFormat="yyyy"
                    showYearPicker
                />
                 to : 
                <DatePicker
                    selected={new Date(endYear, 0, 1)}
                    onChange={(date) => date && setEndYear(date.getFullYear())}
                    dateFormat="yyyy"
                    showYearPicker
                />
            </div>
      </div>
    );
}



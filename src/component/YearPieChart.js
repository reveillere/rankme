
import { Pie } from 'react-chartjs-2';
import { dblpCategories } from '../dblp';


function YearPieChart({ records }) {
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

    const selectedCategories = records
        .map(record => record.type)
        .filter((value, index, self) => self.indexOf(value) === index);    
    
    const data = {
        labels: selectedCategories.map(key => dblpCategories[key].name),
        datasets: [
          {
            data: selectedCategories
              .map(key => records.filter(record => record.type === key).length),
            backgroundColor: selectedCategories
              .map(key => dblpCategories[key].color),
            borderColor: selectedCategories
              .map(key => dblpCategories[key].color),
            borderWidth: 1,
          },
        ],
      };

    
    return (
        <Pie options={pieOptions} data={data} />
    )
}

export default YearPieChart;
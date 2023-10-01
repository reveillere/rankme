// React and React Router
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

// Material-UI Components and Icons
import { CircularProgress, Tab, Tabs, Button } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

// Chart.js Components
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';

// DBLP and CorePortal
import { dblpCategories, fetchAuthor, getPublications } from '../dblp';
import CorePortal from '../corePortal';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { CategoriesPieChart, RanksPieChart, CategoriesByYearChart, RanksByYearChart } from './Statistics';
import { RankSelector, CategoriesSelector } from './Selector';

// Utilities and Styles
import { trimLastDigits } from '../utils';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';



Chart.register(ArcElement, LinearScale, BarController, BarElement, CategoryScale, Tooltip);


export function Author() {
    const [author, setAuthor] = useState(null);

    const pid = useParams()['*'];

    useEffect(() => {
        fetchAuthor(pid)
            .then((author) => {
                setAuthor(author);
            })
            .catch((error) => {
                console.error('Error fetching last publications:', error);
            });
    }, [pid]);

    if (author === null)
        return  (<CircularProgress />)
        ;

    const publications = getPublications(author);
    return <PublicationsViz author={author?.dblpperson?.$} publications={publications} /> ;
}


async function rankJournal(publication) {
    // console.log(publication.dblp);
  }
  
  
  
function PublicationsViz({ author, publications }) {
    const minYear = Math.min(...publications.map(pub => pub.dblp.year));
    const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
    const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
    const [tabGraph, setTabGraph] = useState(0);
    const [tabSelect, setTabSelect] = useState(0);
    const [filterCategories, setFilterCategories] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
    const [filterRanks, setFilterRanks] = React.useState(Object.keys(CorePortal.ranks).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
    const [rankedPublications, setRankedPublications] = useState([...publications]);
    const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
    const [isFilterActive, setIsFilterActive] = useState(false);
  
    const [coreRanks, setCoreRanks] = useState(null);
  
    useEffect(() => {
      const loadCoreRanks = async () => {
        try {
          const ranks = await CorePortal.load();
          setCoreRanks(ranks);
        } catch (error) {
          console.error('Error loading core ranks:', error);
        }
      };
  
      loadCoreRanks();
    }, []);
  
  
    useEffect(() => {
      const rankPublications = async () => {
        if (coreRanks) {
          const updatedRecords = [...rankedPublications];
  
          const inproceedings = updatedRecords.filter(pub => pub.type === 'inproceedings');
          await Promise.all(inproceedings.map(async (pub) => {
            try {
              pub.rank = await CorePortal.rank(coreRanks, pub);
            } catch (error) {
              console.error('Error ranking inproceedings:', error);
            }
          }));
  
          const articles = updatedRecords.filter(pub => pub.type === 'article');
          await Promise.all(articles.map(async (pub) => {
            try {
              await rankJournal(pub);
            } catch (error) {
              console.error('Error ranking article:', error);
            }
          }));
  
          setRankedPublications(updatedRecords);
        }
      };
  
      rankPublications();
    }, [coreRanks]);
  
  
  
    useEffect(() => {
      if (rankedPublications) {
        const publis = rankedPublications
          .filter(pub => pub.dblp.year >= filterYears[0] && pub.dblp.year <= filterYears[1])
          .filter(pub => filterCategories[pub.type])
          .filter(pub => {
            return pub.type === 'inproceedings' ? filterRanks[pub?.rank?.value] : true;
          }
          );
        setFilteredRecords(publis);
      }
    }, [rankedPublications, filterYears, filterCategories, filterRanks]);
  
  
  
    if (!filteredRecords) return <div>Chargement...</div>;
  
    const handleTabGraph = (event, newValue) => {
      setTabGraph(newValue);
    };
  
    const handleTabSelect = (event, newValue) => {
      setTabSelect(newValue);
    };
  
    const publicationsShown = filteredRecords.length;
  
  
  
    return (
      <div className='App'>
  
  
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div id='foo' style={{ textAlign: 'center' }}>
            <h1>Records of {trimLastDigits(author.name)}</h1>
            <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
              {publicationsShown === 0 ? 'No record found' : publicationsShown === publications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${publications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
            </div>
          </div>
  
          <div style={{ marginLeft: '100px', marginTop: '40px'}}>
            <FilterButton isFilterActive={isFilterActive} setIsFilterActive={setIsFilterActive} />
          </div> 
          
        </div>
  
        {isFilterActive &&
  
          <><div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0' }}>
            <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <Tabs value={tabGraph} onChange={handleTabGraph} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
                <Tab label="Stats by type" />
                <Tab label="Stats by year" />
              </Tabs>
              <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                {tabGraph === 0 && tabSelect === 0 && <CategoriesPieChart records={filteredRecords} selected={filterCategories} />}
                {tabGraph === 0 && tabSelect === 1 && <RanksPieChart records={filteredRecords} selected={filterRanks} />}
  
                {tabGraph === 1 && tabSelect === 0 && <CategoriesByYearChart records={filteredRecords} selected={filterCategories} />}
                {tabGraph === 1 && tabSelect === 1 && <RanksByYearChart records={filteredRecords} selected={filterRanks} />}
              </div>
            </div>
            <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: '5em' }}>
              <Tabs value={tabSelect} onChange={handleTabSelect} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
                <Tab label="Categories" />
                <Tab label="Ranks" />
              </Tabs>
              {tabSelect === 0 && <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} />}
              {tabSelect === 1 && <RankSelector records={filteredRecords} selected={filterRanks} setSelected={setFilterRanks} />}
            </div>
          </div>
            <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />
          </>
        }
  
        <div style={{ height: '50px' }}></div>
        <Publications author={author} data={filteredRecords} />
      </div>
  
    );
  }
  
  
  
  
  function FilterButton({ isFilterActive, setIsFilterActive }) {
    const handleButtonClick = () => {
      setIsFilterActive(!isFilterActive); 
    };
  
    return (
      <Button
        variant={isFilterActive ? "contained" : "outlined"}
        color="primary"
        endIcon={<FilterListIcon />}
        onClick={handleButtonClick}
      >
        Filter
      </Button>
    );
  }
import { dblpCategories } from '../dblp';
import { useState, useEffect } from 'react';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css'
import DateRangeSlider from './DateRangeSlider';
import React from 'react';
import { Tab, Tabs } from '@mui/material';
import { Publications } from './PubList';
import CategoriesByYearChart from './CategoriesByYearChart';
import CategoriesSelector from './CategoriesSelector';
import CategoriesByTypeChart from './CategoriesByTypeChart';
import { trimLastDigits } from '../utils';
import CorePortal from '../corePortal'
import RankSelector from './RankSelector';

async function rankJournal(publication) {
  // console.log(publication.dblp);
}



export function PublicationsViz({ author, publications }) {
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
  const [tabGraph, setTabGraph] = useState(0);
  const [tabSelect, setTabSelect] = useState(0);
  const [filterCategories, setFilterCategories] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
  const [filterRanks, setFilterRanks] = React.useState(CorePortal.ranks.reduce((acc, item) => {
    acc[item] = true;
    return acc;
  }, {}));
  const [rankedPublications, setRankedPublications] = useState ([...publications]);
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);

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
            pub.rank = await CorePortal.rank(coreRanks, pub);;
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
          return pub.type === 'inproceedings' ? filterRanks[pub.rank] : true ;
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
      <h1>Records of {trimLastDigits(author.name)}</h1>
      <div style={{ fontSize: 'large', marginTop: '-1em' }}>
        {publicationsShown === 0 ? 'No record found' : publicationsShown === publications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${publications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0' }}>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <Tabs value={tabGraph} onChange={handleTabGraph} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
            <Tab label="Stats by type" />
            <Tab label="Stats by year" />
          </Tabs>
          <div style={{ width: '100%', display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
            {tabGraph === 0 && <CategoriesByTypeChart records={filteredRecords} />}
            {tabGraph === 1 && <CategoriesByYearChart records={filteredRecords} selectedCategories={filterCategories} />}
          </div>
        </div>
        <div style={{ width: '50%', display: 'flex', flexDirection: 'column', alignItems: 'center', marginLeft: '5em' }}>
        <Tabs value={tabSelect} onChange={handleTabSelect} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
            <Tab label="Categories" />
            <Tab label="Ranks" />
          </Tabs>
          {tabSelect === 0 && <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} />}
          {tabSelect === 1 && <RankSelector records={filteredRecords} selected={filterRanks} setSelected={setFilterRanks} /> }
        </div>
      </div>
      <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />
      <div style={{ height: '50px' }}></div>
      <Publications author={author} data={filteredRecords} />
    </div>

  );
}







// React and React Router
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

// Material-UI Components and Icons
import { CircularProgress, Tab, Tabs, Button } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

// Chart.js Components
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';

// DBLP and CorePortal
import { dblpCategories, fetchAuthor, getPublications, getVenueTitle } from '../dblp';
import * as CorePortal from '../corePortal';
import * as SjrPortal from '../sjrPortal';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { CategoriesPieChart, RanksPieChart, CategoriesByYearChart, RanksByYearChart } from './Statistics';
import { RankSelector, CategoriesSelector } from './Selector';

// Utilities and Styles
import { trimLastDigits } from '../utils';
import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

Chart.register(ArcElement, LinearScale, BarController, BarElement, CategoryScale, Tooltip);


export function Author() {
  const [author, setAuthor] = useState(null);

  const pid = useParams()['*'];

  useEffect(() => {
    const fetchData = async function () {
      try {
        const author = await fetchAuthor(pid);
        setAuthor(author)
      } catch (e) {
        console.error(`Error fetching data for author ${pid}: `, e);
      }
    };
    fetchData();
  }, [pid]);

  if (author === null)
    return (<CircularProgress />)
      ;

  const publications = getPublications(author);
  return <AuthorShow author={author?.dblpperson?.$} publications={publications} />;
}




function AuthorShow({ author, publications }) {
  const minYear = Math.min(...publications.map(pub => pub.dblp.year));
  const maxYear = Math.max(...publications.map(pub => pub.dblp.year));
  const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
  const [tabGraph, setTabGraph] = useState(0);
  const [tabSelect, setTabSelect] = useState(0);
  const [filterCategories, setFilterCategories] = React.useState(Object.keys(dblpCategories).reduce((acc, key) => ({ ...acc, [key]: true }), {}));
  const [filterRanks, setFilterRanks] = React.useState({
    ...Object.keys(CorePortal.ranks).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
    ...Object.keys(SjrPortal.ranks).reduce((acc, key) => ({ ...acc, [key]: true }), {}),
  });
  const [rankedPublications, setRankedPublications] = useState([...publications]);
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [updateInProgress, setUpdateInProgress] = useState(false);
  const [updateCompleted, setUpdateCompleted] = useState(false);
  const [updateCompletedPercent, setUpdateCurrentCompleted] = useState(0);   

  useEffect(() => {
    const rankPublication = async (pub, index) => {
      try {
        if (pub.type === 'inproceedings') {
          pub.fullName = await getVenueTitle(pub);
          pub.rank = await CorePortal.rank(pub.venue, pub.fullName, pub.dblp.year);
        } else if (pub.type === 'article') {
          pub.fullName = await getVenueTitle(pub);
          pub.rank = await SjrPortal.rank(pub.fullName, pub.dblp.year); 
        } else {
          return;
        }
        setRankedPublications(prev => {
          const newPublications = [...prev];
          newPublications[index] = pub;
          return newPublications;
        });

      } catch (error) {
        console.error(`Error ranking ${pub.type}:`, error);
      }
    };

    const rankPublications = async () => {
      setUpdateCompleted(false);
      setUpdateInProgress(true);
      let total = publications.length;
      let current = 0;
      for (const [index, pub] of publications.entries()) {
        await rankPublication(pub, index);
        current++;
        setUpdateCurrentCompleted(Math.floor(current / total * 100));
      }
      setUpdateCompleted(true);
      setUpdateInProgress(false);
    };

    rankPublications();
  }, []);



  useEffect(() => {
    const publis = rankedPublications
      .filter(pub => pub.dblp.year >= filterYears[0] && pub.dblp.year <= filterYears[1])
      .filter(pub => filterCategories[pub.type])
      .filter(pub => {
        if (pub.type === 'inproceedings' || pub.type === 'article') {
          if (pub.rank)
            return filterRanks[pub.rank.value];
          else
            return true;
        } else
          return true;
      });
    setFilteredRecords(publis);
  }, [rankedPublications, filterYears, filterCategories, filterRanks]);



  if (!filteredRecords) return <div>Chargement...</div>;

  const handleTabGraph = (event, newValue) => {
    setTabGraph(newValue);
  };

  const handleTabSelect = (event, newValue) => {
    setTabSelect(newValue);
  };

  const publicationsShown = filteredRecords.length;

  const ranks = { ...CorePortal.ranks, ...SjrPortal.ranks };

  return (
    <div className='App'>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div id='foo' style={{ textAlign: 'center' }}>
          <h1>Records of {trimLastDigits(author.name)}</h1>
          <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
            {publicationsShown === 0 ? 'No record found' : publicationsShown === publications.length ? `Showing all ${publicationsShown} records` : `Zoomed in of ${publicationsShown} of ${publications.length} records in the period of ${filterYears[1] - filterYears[0] + 1} years`}
          </div>
        </div>

        <div style={{ marginLeft: '100px', marginTop: '40px' }}>
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
            {tabGraph === 0 && tabSelect === 1 && <RanksPieChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}

              {tabGraph === 1 && tabSelect === 0 && <CategoriesByYearChart records={filteredRecords} selected={filterCategories} />}
            {tabGraph === 1 && tabSelect === 1 && <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}
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

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        open={updateInProgress}
      >
        <Alert severity="info" sx={{ width: '100%' }}>
          Update in progress ({updateCompletedPercent}%)
        </Alert>
      </Snackbar>

      <Snackbar
        anchorOrigin={{
          vertical: 'bottom',
          horizontal: 'right',
        }}
        open={updateCompleted}
        onClose={() => setUpdateCompleted(false)}
        autoHideDuration={3000}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Update completed!
        </Alert>
      </Snackbar>
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
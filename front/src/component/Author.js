// React and React Router
import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';

// Material-UI Components and Icons
import { CircularProgress, Tab, Tabs, Button } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import { createTheme } from '@mui/material/styles';

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
const theme = createTheme();


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
    return (
      <Box style={{
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        height: '100vh' // prend toute la hauteur de la fenêtre
      }}>
        <CircularProgress color="primary" />
        <span style={{ color: theme.palette.primary.main }}>
          Loading...
        </span></Box>

    )
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
    const rankable = (pub) => pub.type === 'inproceedings' || pub.type === 'article';

    const rankPublications = async () => {
      setUpdateCompleted(false);
      setUpdateInProgress(true);

      const total = publications.length * 2;
      let current = 0;

      const makeProgress = () => {
        current++;
        setUpdateCurrentCompleted(Math.floor(current / total * 100));
      }

      const rankPublication = async (pub, index) => {
        try {
          if (rankable(pub)) {
            if (!pub.hasOwnProperty('fullName')) {
              if (pub.dblp.fullName) {
                pub.fullName = pub.dblp.fullName;
              } else {
                pub.fullName = await getVenueTitle(pub);
              }
            }
            makeProgress();

            if (!pub.hasOwnProperty('rank')) {
              if (pub.dblp.rank) {
                pub.rank = pub.dblp.rank;
              } else {
                if (pub.type === 'inproceedings') {
                  pub.rank = await CorePortal.rank(pub.venue, pub.dblp.url, pub.dblp.year);
                } else if (pub.type === 'article') {
                  pub.rank = await SjrPortal.rank(pub.dblp.url, pub.dblp.year);
                }
              }
            }
            makeProgress();

          } else {
            makeProgress(); makeProgress();
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

      await Promise.all(publications.map(rankPublication));

      setUpdateInProgress(false);
      setUpdateCompleted(true);
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
        {isFilterActive || <div style={{ marginLeft: '50px', marginRight: '100px', marginTop: '40px' }}>
          <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} />
        </div>}
        
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

<>
<div style={{ display: 'flex', justifyContent: 'space-between', margin: '10px 0 40px 0', height: '250px', boxSizing: 'border-box', overflow: 'hidden'  }}>
  <div style={{ width: '45%', display: 'flex', flexDirection: 'column', alignItems: 'center', boxSizing: 'border-box' }}>
    <Tabs value={tabGraph} onChange={handleTabGraph} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
      <Tab label="Stats by year" />
      <Tab label="Stats by type" />
    </Tabs>
    <div style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      {tabGraph === 0 && tabSelect === 0 && <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}
      {tabGraph === 0 && tabSelect === 1 && <CategoriesByYearChart records={filteredRecords} selected={filterCategories} />}

      {tabGraph === 1 && tabSelect === 0 && <RanksPieChart records={filteredRecords} selected={filterRanks} ranks={ranks} />}
      {tabGraph === 1 && tabSelect === 1 && <CategoriesPieChart records={filteredRecords} selected={filterCategories} />}
    </div>
  </div>
  <div style={{ width: '45%', display: 'flex', flexDirection: 'column', marginLeft: '10%', alignItems: 'center', boxSizing: 'border-box' }}>
    <Tabs value={tabSelect} onChange={handleTabSelect} aria-label="graph-type" centered style={{ marginBottom: '20px' }}>
      <Tab label="Ranks" />
      <Tab label="Categories" />
    </Tabs>
    {tabSelect === 0 && <RankSelector records={filteredRecords} selected={filterRanks} setSelected={setFilterRanks} />}
    {tabSelect === 1 && <CategoriesSelector records={filteredRecords} selected={filterCategories} setSelected={setFilterCategories} />}
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
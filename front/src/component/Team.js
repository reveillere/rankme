import React, { useState, useEffect, useMemo } from 'react';

// Material-UI Components and Icons
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';

// Chart.js Components
import { ArcElement, Chart, LinearScale, BarController, BarElement, CategoryScale, Tooltip } from 'chart.js';

import { useMergedRankedPublications } from '../useMergedRankedPublications';
import { getTeam } from '../teamStore';
import { ranks, useFilterSettings } from '../FilterSettingsContext';
import { getHalCategory } from '../hal';

// Components
import DateRangeSlider from './DateRangeSlider';
import { Publications } from './Publications';
import { HalPublications } from './HalPublications';
import { RanksByYearChart } from './Statistics';
import { RankSummary } from './RankSummary';
import { FilterButton } from './FilterButton';
import { ReviewFilterToggle } from './ReviewFilterToggle';
import { LoadingSpinner } from './LoadingSpinner';
import { filterPublications } from '../filterPublications';
import { needsReview, getSharedOverride } from '../matchOverrides';
import { useOverrideRefreshTick } from '../useOverrideRefreshTick';
import { useSharedOverridesMaps } from '../useSharedOverridesMaps';

import 'react-datepicker/dist/react-datepicker.css';
import '../App.css';

const Alert = React.forwardRef(function Alert(props, ref) {
  return <MuiAlert elevation={6} ref={ref} variant="filled" {...props} />;
});

Chart.register(ArcElement, LinearScale, BarController, BarElement, CategoryScale, Tooltip);

const yearAccessorFor = source => (source === 'hal' ? (pub => pub.year) : (pub => pub.dblp.year));
// HAL's own type codes aren't the shared category vocabulary — cssClass
// maps each one to its dblp-bucket equivalent (see filterPublications.js).
const categoryKeyAccessorFor = source => (source === 'hal' ? (pub => getHalCategory(pub.type).cssClass) : (pub => pub.type));
const portalAccessorFor = source => (source === 'hal' ? (pub => pub.type === 'COMM' ? 'core' : 'sjr') : (pub => pub.type === 'inproceedings' ? 'core' : 'sjr'));

export function Team({ teamId, onOpenAuthor, onSearchAuthor }) {
  const team = getTeam(teamId);

  if (!team) {
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>This team no longer exists.</div>;
  }

  return <TeamShow team={team} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} />;
}

function TeamShow({ team, onOpenAuthor, onSearchAuthor }) {
  const { publications: rankedPublications, progress, done, failed } = useMergedRankedPublications(team.source, team.members);

  if (failed)
    return <div style={{ textAlign: 'center', marginTop: '80px' }}>Failed to load this team&apos;s members from {team.source === 'hal' ? 'HAL' : 'DBLP'}. Please try again later.</div>;

  if (rankedPublications === null)
    return <LoadingSpinner message={progress.total > 0 ? `Computing ranks for ${team.members.length} members…` : `Loading publications for ${team.members.length} members…`} progress={progress} />;

  return (
    <TeamContent
      team={team}
      publications={rankedPublications}
      progress={progress}
      done={done}
      onOpenAuthor={onOpenAuthor}
      onSearchAuthor={onSearchAuthor}
    />
  );
}

function TeamContent({ team, publications: rankedPublications, progress, done, onOpenAuthor, onSearchAuthor }) {
  const isHal = team.source === 'hal';
  const yearAccessor = useMemo(() => yearAccessorFor(team.source), [team.source]);
  const categoryKeyAccessor = useMemo(() => categoryKeyAccessorFor(team.source), [team.source]);
  const portalAccessor = useMemo(() => portalAccessorFor(team.source), [team.source]);
  const selfIds = useMemo(() => team.members.map(m => m.id), [team]);

  const [minYear, maxYear] = useMemo(() => {
    const knownYears = rankedPublications.map(yearAccessor).filter(year => year != null);
    const currentYear = new Date().getFullYear();
    if (knownYears.length === 0) return [currentYear, currentYear];
    return [Math.min(...knownYears), Math.max(...knownYears)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rankedPublications.length, team.source]);
  const [filterYears, setFilterYears] = React.useState([minYear, maxYear]);
  const { filterRanks, filterCategories } = useFilterSettings();
  const [filteredRecords, setFilteredRecords] = useState(rankedPublications);
  const [isFilterActive, setIsFilterActive] = useState(false);
  const [reviewOnly, setReviewOnly] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [showCompleted, setShowCompleted] = useState(false);
  const overrideTick = useOverrideRefreshTick();
  const sharedMaps = useSharedOverridesMaps();

  useEffect(() => {
    if (done) setShowCompleted(true);
  }, [done]);

  useEffect(() => {
    const records = filterPublications(rankedPublications, { yearAccessor, filterYears, filterCategories, categoryKeyAccessor, filterRanks });
    const toReview = records.filter(pub => {
      const portal = portalAccessor(pub);
      return needsReview(portal, pub.rank, getSharedOverride(pub.rank, sharedMaps[portal]));
    });
    setReviewCount(toReview.length);
    setFilteredRecords(reviewOnly && toReview.length > 0 ? toReview : records);
  }, [rankedPublications, filterYears, filterCategories, filterRanks, yearAccessor, categoryKeyAccessor, reviewOnly, portalAccessor, overrideTick, sharedMaps]);

  const publicationsShown = filteredRecords.length;
  const updateCompletedPercent = progress.total ? Math.floor(progress.completed / progress.total * 100) : 0;

  // Hiding the filter also clears it — otherwise the year range stays
  // narrowed behind the scenes while the button looks inactive again.
  const handleFilterActiveChange = (active) => {
    setIsFilterActive(active);
    if (!active) setFilterYears([minYear, maxYear]);
  };

  return (
    <div className='App'>
      <div style={{ textAlign: 'center', marginTop: '40px', padding: '0 160px' }}>
        <h1>Records of {team.name} ({team.members.length} members)</h1>
        <div style={{ fontSize: 'large', marginTop: '-0.8em' }}>
          {publicationsShown === 0 ? 'No record found' : publicationsShown === rankedPublications.length ? `Showing all ${publicationsShown} deduplicated records` : `Showing ${publicationsShown} of ${rankedPublications.length} records over ${filterYears[1] - filterYears[0] + 1} years`}
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '40px', margin: '30px 0 40px 0' }}>
        <RanksByYearChart records={filteredRecords} selected={filterRanks} ranks={ranks} yearAccessor={yearAccessor} />
        <RankSummary records={filteredRecords} ranks={ranks} selected={filterRanks} />
      </div>

      <div style={{ margin: '0 0 20px 0' }}>
        <FilterButton isFilterActive={isFilterActive} setIsFilterActive={handleFilterActiveChange} />
      </div>

      {isFilterActive && <DateRangeSlider minYear={minYear} maxYear={maxYear} range={filterYears} setRange={setFilterYears} />}

      <div style={{ height: '50px' }}></div>

      <ReviewFilterToggle count={reviewCount} checked={reviewOnly} onChange={setReviewOnly} />
      {isHal
        ? <HalPublications selfIds={selfIds} data={filteredRecords} onOpenAuthor={onOpenAuthor} onSearchAuthor={onSearchAuthor} />
        : <Publications data={filteredRecords} onOpenAuthor={onOpenAuthor} selfPids={selfIds} />}

      <Snackbar anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }} open={!done}>
        <Alert severity="info" sx={{ width: '100%' }}>
          Update in progress ({updateCompletedPercent}%)
        </Alert>
      </Snackbar>

      <Snackbar
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        open={showCompleted}
        onClose={() => setShowCompleted(false)}
        autoHideDuration={3000}
      >
        <Alert severity="success" sx={{ width: '100%' }}>
          Update completed!
        </Alert>
      </Snackbar>
    </div>
  );
}

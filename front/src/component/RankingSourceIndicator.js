import Chip from '@mui/material/Chip';

import { CONFERENCE_SOURCES, JOURNAL_SOURCES, customProfileIdFrom } from '../rankingSource';
import { getProfile } from '../customRankings';
import { useFilterSettings } from '../FilterSettingsContext';

// Always shown in the toolbar (see App.js). Reads the live values from
// context (not localStorage directly) so it updates the instant either
// setting changes, in step with the rank badges/charts/stats themselves --
// see FilterSettingsContext.js for why these preferences live there instead
// of being a one-off localStorage read the way e.g. useCommunityOverrides is.
// A custom:* source (customRankings.js) shows its profile's own name rather
// than the raw stored value -- a stale reference (the profile got deleted)
// still falls back to the raw string for one render, but
// FilterSettingsContext.js's own self-healing effect clears that up
// immediately after, same as everywhere else a deleted profile is handled.
function labelFor(source, sourcesTable) {
  if (sourcesTable[source]) return sourcesTable[source].shortLabel;
  const profileId = customProfileIdFrom(source);
  if (profileId) return `Custom: ${getProfile(profileId)?.name ?? source}`;
  return source;
}

export function RankingSourceIndicator({ onOpenSettings }) {
  const { conferenceSource, journalSource } = useFilterSettings();
  const confLabel = labelFor(conferenceSource, CONFERENCE_SOURCES);
  const journalLabel = labelFor(journalSource, JOURNAL_SOURCES);
  const label = confLabel === journalLabel ? confLabel : `${confLabel} + ${journalLabel}`;
  return (
    <Chip
      size="small"
      label={label}
      onClick={onOpenSettings}
      clickable
      sx={{ mr: 1.5, color: 'inherit', borderColor: 'rgba(255,255,255,0.5)' }}
      variant="outlined"
    />
  );
}

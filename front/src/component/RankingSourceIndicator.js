import Chip from '@mui/material/Chip';

import { RANKING_SOURCES } from '../rankingSource';
import { useFilterSettings } from '../FilterSettingsContext';

// Always shown in the toolbar (see App.js). Reads the live value from
// context (not localStorage directly) so it updates the instant the
// setting changes, in step with the rank badges/charts/stats themselves --
// see FilterSettingsContext.js for why this preference lives there instead
// of being a one-off localStorage read the way e.g. useCommunityOverrides is.
export function RankingSourceIndicator({ onOpenSettings }) {
  const { rankingSource } = useFilterSettings();
  return (
    <Chip
      size="small"
      label={RANKING_SOURCES[rankingSource].shortLabel}
      onClick={onOpenSettings}
      clickable
      sx={{ mr: 1.5, color: 'inherit', borderColor: 'rgba(255,255,255,0.5)' }}
      variant="outlined"
    />
  );
}

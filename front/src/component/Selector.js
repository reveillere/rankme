import React from 'react';
import { Checkbox, FormGroup, FormControlLabel, Tooltip, Button, Box } from '@mui/material';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import RemoveDoneIcon from '@mui/icons-material/RemoveDone';
import CorePortal from '../corePortal';
import SjrPortal from '../sjrPortal';

// Shared by every checkbox list in the settings dialog (categories, and
// each rank sub-list nested under one) instead of each rolling its own
// plain-text links.
export function SelectAllControls({ onSelectAll, onDeselectAll, size = 'small' }) {
  return (
    <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
      <Button size={size} startIcon={<DoneAllIcon fontSize="small" />} onClick={onSelectAll} sx={{ textTransform: 'none' }}>
        Select all
      </Button>
      <Button size={size} startIcon={<RemoveDoneIcon fontSize="small" />} onClick={onDeselectAll} sx={{ textTransform: 'none' }}>
        Deselect all
      </Button>
    </Box>
  );
}

export function Selector({ records, selected, setSelected, data, filterKey, disabledKeys = [], disabledReason }) {
  // `records` is omitted when this selector is used as a global setting
  // (e.g. the settings dialog) rather than scoped to one author's
  // publications — in that case there's nothing to count against, so just
  // render the plain labels.
  const showCounts = records !== undefined;
  const [recordCountByType, setRecordCountByType] = React.useState({});

  React.useEffect(() => {
    if (!showCounts) return;
    const counts = Object.keys(selected).reduce((acc, key) => ({
      ...acc,
      [key]: records.filter(record => filterKey(record) === key).length
    }), {});
    setRecordCountByType(counts);
    // Deliberately scoped to `records` only: this snapshots the counts as of
    // the last data change, so the label can show "what it used to be
    // selected" beside the live count — re-running on every `selected`
    // toggle would erase that distinction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records]);

  const handleSelectAll = () => {
    const updates = Object.keys(data).reduce((acc, key) => ({ ...acc, [key]: true }), {});
    setSelected({ ...selected, ...updates });
  };

  const handleUnselectAll = () => {
    const updates = Object.keys(data).reduce((acc, key) => ({ ...acc, [key]: false }), {});
    setSelected({ ...selected, ...updates });
  };

  return (
    <FormGroup style={{ margin: 0, padding: 0 }}>
      {Object.entries(data).map(([key, value]) => {
        const isDisabled = disabledKeys.includes(key);

        const control = (
          <FormControlLabel
            disabled={isDisabled}
            control={
              <Checkbox
                checked={selected[key] || false}
                size="small"
                name={key}
                style={{ color: value.color }}
              />}
            label={
              showCounts ? (
                <span style={{ color: selected[key] ? 'inherit' : 'lightgray' }}>
                {(() => {
                    let count = records.filter(record => filterKey(record) === key).length;
                    if (selected[key])
                      return `${value.name} (${count})`
                    else
                      return `${value.name} (${recordCountByType[key]})`
                  })()}
                </span>
              ) : (
                <span style={{ color: selected[key] ? 'inherit' : 'lightgray' }}>{value.name}</span>
              )
            }
            onChange={() => setSelected({ ...selected, [key]: !selected[key] })}
            style={{ margin: 0, width: '100%', fontSize: '0.8rem' }}
          />
        );

        return (
          <div
            key={key}
            style={{ marginBottom: '-14px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          >
            {isDisabled && disabledReason
              ? <Tooltip title={disabledReason} placement="right">{control}</Tooltip>
              : control}
          </div>
        );
      })}
      <SelectAllControls onSelectAll={handleSelectAll} onDeselectAll={handleUnselectAll} />
    </FormGroup>
  );
}

export function RankSelector({ coreDisabled, journalDisabled, ...props }) {
  const disabledReason = 'Select at least one matching category to use this rank';
  return (
    <div style={{ display: "flex", gap: "0px", width: '400px' }}>
      <div style={{ width: '200px' }}>
        <Selector
          {...props}
          data={CorePortal.ranks}
          filterKey={record => record.rank?.value}
          disabledKeys={coreDisabled ? Object.keys(CorePortal.ranks) : []}
          disabledReason={disabledReason}
        />
      </div>
      <div style={{ width: '200px' }}>
        <Selector
          {...props}
          data={SjrPortal.ranks}
          filterKey={record => record.rank?.value}
          disabledKeys={journalDisabled ? Object.keys(SjrPortal.ranks) : []}
          disabledReason={disabledReason}
        />
      </div>
      <div style={{ clear: "both" }}></div>
    </div>
  );
}


export function CategoriesSelector({ categories, ...props }) {
  return (
    <div style={{ width: '400px' }}>
      <Selector {...props} data={categories} filterKey={record => record.type} />
    </div>
  );
}
 
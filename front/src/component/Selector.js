import React from 'react';
import { Checkbox, FormGroup, FormControlLabel } from '@mui/material';
import CorePortal from '../corePortal';
import SjrPortal from '../sjrPortal';

function Selector({ records, selected, setSelected, data, filterKey }) {
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
    const allSelected = Object.keys(selected).reduce((acc, key) => ({ ...acc, [key]: true }), {});
    setSelected(allSelected);
  };

  const handleUnselectAll = () => {
    const noneSelected = Object.keys(selected).reduce((acc, key) => ({ ...acc, [key]: false }), {});
    setSelected(noneSelected);
  };

  return (
    <FormGroup style={{ margin: 0, padding: 0 }}>
      {Object.entries(data).map(([key, value]) => (
        <div
          key={key}
          style={{ marginBottom: '-14px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <FormControlLabel
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
        </div>
      ))}
      <div style={{ marginTop: '10px', marginLeft: '10px' }}>
        <a href="#" onClick={(e) => { e.preventDefault(); handleSelectAll(e); }} style={{ marginRight: '10px', cursor: 'pointer', textDecoration: 'underline' }}>select all</a>
        |
        <a href="#" onClick={(e) => { e.preventDefault(); handleUnselectAll(e); }} style={{ marginLeft: '10px', cursor: 'pointer', textDecoration: 'underline' }}>deselect all</a>
      </div>
    </FormGroup>
  );
}

export function RankSelector(props) {
  return (
    <div style={{ display: "flex", gap: "0px", width: '400px' }}>
      <div style={{ width: '200px' }}> 
        <Selector {...props} data={CorePortal.ranks} filterKey={record => record.rank?.value} />
      </div>
      <div style={{ width: '200px' }}> 
        <Selector {...props} data={SjrPortal.ranks} filterKey={record => record.rank?.value} />
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
 
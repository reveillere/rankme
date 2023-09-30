import React from 'react';
import { Checkbox, FormGroup, FormControlLabel } from '@mui/material';
import CorePortal from '../corePortal';
import { dblpCategories } from '../dblp';

function Selector({ records, selected, setSelected, data, filterKey }) {
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
            label={`${value.name} (${records.filter(record => record[filterKey] === key).length})`}
            onChange={() => setSelected({ ...selected, [key]: !selected[key] })}
            style={{ margin: 0, width: '400px', fontSize: '0.8rem' }}
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
  return <Selector {...props} data={CorePortal.ranks} filterKey="rank" />;
}

export function CategoriesSelector(props) {
  return <Selector {...props} data={dblpCategories} filterKey="type" />;
}


import React from 'react';
import { Checkbox, FormGroup, FormControlLabel } from '@mui/material';
import { dblpCategories } from '../dblp';
import CorePortal from '../corePortal';

function RankSelector({ records, selected, setSelected }) {

  const handleSelectAll = () => {
    const allSelected = {};
    Object.keys(selected).forEach(key => {
      allSelected[key] = true;
    });
    setSelected(allSelected);
  };

  const handleUnselectAll = () => {
    const noneSelected = {};
    Object.keys(selected).forEach(key => {
      noneSelected[key] = false;
    });
    setSelected(noneSelected);
  };

  return (
    <FormGroup style={{ margin: 0, padding: 0 }}>
      { CorePortal.ranks.map(rank => (
        <div
          key={rank}
          style={{ marginBottom: '-14px', display: 'flex', alignItems: 'center', cursor: 'pointer' }}
        >
          <FormControlLabel
            control={
              <Checkbox
                checked={selected[rank] || false}
                size="small"
                name={rank}
                style={{ color: dblpCategories.inproceedings.color }}
              />}
            label={`${rank} (${records.filter(record => record.rank === rank).length})`}
            onChange={() => setSelected({ ...selected, [rank]: !selected[rank] })}
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

export default RankSelector;
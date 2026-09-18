import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import DescriptionIcon from '@mui/icons-material/Description';

// Cross-check report export. Kept separate from ExportButton so the regular
// publication-list export keeps its familiar download icon while this action
// reads as a report/document next to the personal decision file controls.
export function ReportButton({ onExportMarkdown, onExportJson, onExportCsv, disabled = false }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const select = (callback, format) => {
    setAnchorEl(null);
    const url = new URL(window.location.href);
    url.searchParams.set('export', format);
    window.history.replaceState({}, '', url);
    callback();
  };
  return <>
    <Tooltip title="Cross-check report">
      <span>
        <IconButton color="primary" size="small" aria-label="cross-check report" disabled={disabled} onClick={event => setAnchorEl(event.currentTarget)} sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}>
          <DescriptionIcon fontSize="small" />
        </IconButton>
      </span>
    </Tooltip>
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
      <MenuItem onClick={() => select(onExportMarkdown, 'md')}>Markdown</MenuItem>
      <MenuItem onClick={() => select(onExportJson, 'json')}>JSON</MenuItem>
      <MenuItem onClick={() => select(onExportCsv, 'csv')}>CSV</MenuItem>
    </Menu>
  </>;
}

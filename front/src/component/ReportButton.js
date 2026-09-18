import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import DescriptionIcon from '@mui/icons-material/Description';

// Document-style export, as opposed to ExportButton's plain-data download
// icon: used both for a cross-check page's own report (title="Cross-check
// report", set explicitly by CrossCheck.js/CrossCheckTeam.js/
// CrossCheckStructure.js) and, with the default title, as the main
// Markdown/JSON/CSV export on the publication-list pages (Author.js/
// AuthorHal.js/Team.js/Structure.js) -- those used ExportButton's download
// icon previously, but a formatted publication list reads as a report too.
export function ReportButton({ onExportMarkdown, onExportJson, onExportCsv, disabled = false, title = 'Report' }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const select = (callback, format) => {
    setAnchorEl(null);
    const url = new URL(window.location.href);
    url.searchParams.set('export', format);
    window.history.replaceState({}, '', url);
    callback();
  };
  return <>
    <Tooltip title={title}>
      <span>
        <IconButton color="primary" size="small" aria-label={title.toLowerCase()} disabled={disabled} onClick={event => setAnchorEl(event.currentTarget)} sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}>
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

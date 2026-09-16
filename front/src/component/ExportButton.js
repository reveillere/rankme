import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';

// One shared button/menu for every page that offers an export (the 4
// publication-list pages -- Author.js/AuthorHal.js/Team.js/Structure.js --
// and the 3 cross-check pages -- CrossCheck.js/CrossCheckTeam.js/
// CrossCheckStructure.js) -- replaces what used to be two separate
// "Export Markdown"/"Export CSV" buttons per page with a single "Export"
// button opening a 3-way choice. Same IconButton+Menu+MenuItem pattern as
// SortButton.js (see that file), reused as-is here so the two buttons that
// sit side by side in each page's button row look and behave the same way.
// Deliberately agnostic of *what* gets exported: each page passes its own
// onExportMarkdown/onExportJson/onExportCsv callback, already closed over
// whatever title/filename/sortMode (or results/members) that page's own
// export needs, so this component has no idea whether it's exporting a
// publication list or a cross-check report.
export function ExportButton({ onExportMarkdown, onExportJson, onExportCsv, disabled = false }) {
  const [anchorEl, setAnchorEl] = useState(null);

  const handleSelect = (onExport, format) => {
    setAnchorEl(null);
    const url = new URL(window.location.href);
    url.searchParams.set('export', format);
    window.history.replaceState({}, '', url);
    onExport();
  };

  return (
    <>
      <Tooltip title="Export">
        {/* Span wrapper so the Tooltip still works when `disabled` is true --
            CrossCheckTeam.js/CrossCheckStructure.js pass disabled while a
            report has no members yet, and MUI's Tooltip needs a
            non-disabled DOM node to attach its hover listeners to. */}
        <span>
          <IconButton
            color="primary"
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label="export"
            disabled={disabled}
            sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        <MenuItem onClick={() => handleSelect(onExportMarkdown, 'md')}>Markdown</MenuItem>
        <MenuItem onClick={() => handleSelect(onExportJson, 'json')}>JSON</MenuItem>
        <MenuItem onClick={() => handleSelect(onExportCsv, 'csv')}>CSV</MenuItem>
      </Menu>
    </>
  );
}

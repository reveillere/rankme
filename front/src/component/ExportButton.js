import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import DownloadIcon from '@mui/icons-material/Download';

// One shared button/menu for every page/dialog that offers a plain-data
// export -- Teams.js (teams and team members), IdentityLinksPanel.js,
// MyOverridesDialog.js, MyCustomRankingsDialog.js. The 4 publication-list
// pages (Author.js/AuthorHal.js/Team.js/Structure.js) and the 3 cross-check
// pages (CrossCheck.js/CrossCheckTeam.js/CrossCheckStructure.js) use
// ReportButton.js instead -- same Menu-of-formats shape, but its document
// icon reads as a report rather than a raw data download. Same
// IconButton+Menu+MenuItem pattern as SortButton.js (see that file) and
// ReportButton.js, reused as-is here so buttons that sit side by side in a
// page's button row look and behave the same way. Deliberately agnostic of
// *what* gets exported: each caller passes its own
// onExportMarkdown/onExportJson/onExportCsv callback, already closed over
// whatever title/filename/sortMode (or results/members) its own export
// needs. Each callback is optional -- only the formats a caller actually
// supports get a menu entry, same as ImportButton's own
// onImportJson/onImportCsv/onImportTxt.
export function ExportButton({ onExportMarkdown, onExportJson, onExportCsv, disabled = false, updateUrl = true, title = 'Export' }) {
  const [anchorEl, setAnchorEl] = useState(null);

  const handleSelect = (onExport, format) => {
    setAnchorEl(null);
    if (updateUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('export', format);
      window.history.replaceState({}, '', url);
    }
    onExport();
  };

  return (
    <>
      <Tooltip title={title}>
        {/* Span wrapper so the Tooltip still works when `disabled` is true --
            CrossCheckTeam.js/CrossCheckStructure.js pass disabled while a
            report has no members yet, and MUI's Tooltip needs a
            non-disabled DOM node to attach its hover listeners to. */}
        <span>
          <IconButton
            color="primary"
            size="small"
            onClick={(e) => setAnchorEl(e.currentTarget)}
            aria-label={title.toLowerCase()}
            disabled={disabled}
            sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}
          >
            <DownloadIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
        {onExportMarkdown && <MenuItem onClick={() => handleSelect(onExportMarkdown, 'md')}>Markdown</MenuItem>}
        {onExportJson && <MenuItem onClick={() => handleSelect(onExportJson, 'json')}>JSON</MenuItem>}
        {onExportCsv && <MenuItem onClick={() => handleSelect(onExportCsv, 'csv')}>CSV</MenuItem>}
      </Menu>
    </>
  );
}

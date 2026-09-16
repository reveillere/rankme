import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import Tooltip from '@mui/material/Tooltip';
import UploadIcon from '@mui/icons-material/Upload';

// Counterpart of ExportButton: callers decide which file formats they can
// safely read, while every compact import control looks and behaves alike.
export function ImportButton({ onImportJson, onImportCsv, onImportTxt, disabled = false, title = 'Import' }) {
  const [anchorEl, setAnchorEl] = useState(null);
  const choose = callback => { setAnchorEl(null); callback?.(); };
  return <>
    <Tooltip title={title}><span><IconButton color="primary" size="small" disabled={disabled} onClick={e => setAnchorEl(e.currentTarget)} aria-label="import" sx={{ border: '1px solid', borderColor: 'primary.main', borderRadius: '20px', padding: '6px' }}><UploadIcon fontSize="small" /></IconButton></span></Tooltip>
    <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={() => setAnchorEl(null)}>
      {onImportJson && <MenuItem onClick={() => choose(onImportJson)}>JSON</MenuItem>}
      {onImportCsv && <MenuItem onClick={() => choose(onImportCsv)}>CSV</MenuItem>}
      {onImportTxt && <MenuItem onClick={() => choose(onImportTxt)}>TXT</MenuItem>}
    </Menu>
  </>;
}

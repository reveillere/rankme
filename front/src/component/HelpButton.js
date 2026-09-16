import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

// A compact, contextual help entry point. Sections keep each workflow and
// its concrete file format together instead of hiding them in tooltips.
export function HelpButton({ title, sections, label, color = 'default' }) {
  const [open, setOpen] = useState(false);
  return <>
    {label
      ? <Button color={color} startIcon={<HelpOutlineIcon />} onClick={() => setOpen(true)} sx={{ textTransform: 'none' }}>{label}</Button>
      : <Tooltip title="Help"><IconButton size="small" onClick={() => setOpen(true)} aria-label="help"><HelpOutlineIcon fontSize="small" /></IconButton></Tooltip>}
    <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers sx={{ py: 2 }}>
        {sections.map((section, index) => <Box key={section.title} sx={{ mb: index === sections.length - 1 ? 0 : 2.25 }}>
          <Typography variant="subtitle2" sx={{ color: 'primary.main', mb: 0.5 }}>{section.title}</Typography>
          <Typography variant="body2" color="text.secondary">{section.description}</Typography>
          {section.example && <Paper variant="outlined" sx={{ mt: 1, px: 1.25, py: 1, bgcolor: 'grey.50', overflow: 'auto' }}><Box component="pre" sx={{ m: 0, fontSize: 12, lineHeight: 1.45, fontFamily: 'monospace' }}>{section.example}</Box></Paper>}
        </Box>)}
      </DialogContent>
      <DialogActions><Button onClick={() => setOpen(false)}>Close</Button></DialogActions>
    </Dialog>
  </>;
}

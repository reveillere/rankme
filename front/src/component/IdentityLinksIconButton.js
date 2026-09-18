import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import LinkIcon from '@mui/icons-material/Link';
import { IdentityLinksPanel } from './IdentityLinksPanel';

// Icon-only counterpart of IdentityLinksButton.js's text Button -- same
// "Manage identity links" trigger, sized to sit inline with the rest of a
// cross-check page's small icon row (CrossCheckIdentityHeader.js's own
// "View members" IconButton, HelpButton, etc.) instead of a full labeled
// Button. Self-contained by default (owns its own open state), same shape
// as IdentityLinksButton.js -- but CrossCheckIdentityHeader.js needs the
// panel's open state lifted to its caller, because CrossCheckStructure.js/
// CrossCheckTeam.js also render the very same IdentityLinksPanel directly
// (open by default) while the report is still loading, before this header
// even mounts, and both must share one state. Passing `open`/`onOpen`
// turns this into a controlled trigger for that case instead of duplicating
// the default-open bookkeeping here.
export function IdentityLinksIconButton({ open: openProp, onOpen, onClose, ...props }) {
  const [internalOpen, setInternalOpen] = useState(false);
  const controlled = openProp !== undefined;
  const open = controlled ? openProp : internalOpen;
  const handleOpen = () => (controlled ? onOpen() : setInternalOpen(true));
  const handleClose = () => (controlled ? onClose() : setInternalOpen(false));
  return <>
    <Tooltip title="Manage identity links"><IconButton size="small" onClick={handleOpen}><LinkIcon fontSize="inherit" /></IconButton></Tooltip>
    <IdentityLinksPanel {...props} open={open} onClose={handleClose} />
  </>;
}

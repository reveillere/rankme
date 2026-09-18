import { useState } from 'react';
import Button from '@mui/material/Button';
import { IdentityLinksPanel } from './IdentityLinksPanel';

export function IdentityLinksButton({ all = false, variant = 'outlined', startIcon, ...props }) {
  const [open, setOpen] = useState(false);
  return <>
    <Button size="small" variant={variant} startIcon={startIcon} onClick={() => setOpen(true)}>{all ? 'My identity links' : 'Identity links'}</Button>
    <IdentityLinksPanel {...props} all={all} open={open} onClose={() => setOpen(false)} />
  </>;
}

import { useState } from 'react';
import Alert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import VisibilityIcon from '@mui/icons-material/Visibility';
import { MemberListDialog } from './MemberListDialog';
import { IdentityLinksIconButton } from './IdentityLinksIconButton';
import { HelpButton } from './HelpButton';

// Shared chrome for structure and team cross-checks. Their only difference
// is where the members came from and which identity direction is needed.
export function CrossCheckIdentityHeader({ title, scope, members, unresolvedCount, targetLabel, panelProps, panelOpen, setPanelOpen }) {
  const [membersOpen, setMembersOpen] = useState(false);
  return <>
    <div style={{ textAlign: 'center', marginTop: '40px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '4px' }}><h1>{title}</h1><HelpButton title="Cross-check help" sections={[{ title: 'Identity links', description: 'Open Identity links to confirm a proposal or select a different identity for a member.' }, { title: 'Partial results', description: 'The warning identifies members without a confirmed identity. Their publications are absent until the link is confirmed.' }, { title: 'Export formats', description: 'Export contains the current partial results. Markdown is readable, JSON preserves structured results, and CSV opens in spreadsheet software.' }]} /></div>
      <div style={{ fontStyle: 'italic', fontSize: 'small', color: '#8a8f94', marginTop: '-0.6em', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '2px' }}>
        {scope} of {members.length} members
        <Tooltip title="View members"><IconButton size="small" onClick={() => setMembersOpen(true)}><VisibilityIcon fontSize="inherit" /></IconButton></Tooltip>
        <IdentityLinksIconButton open={panelOpen} onOpen={() => setPanelOpen(true)} onClose={() => setPanelOpen(false)} onViewResults={() => setPanelOpen(false)} {...panelProps} />
      </div>
    </div>
    <MemberListDialog open={membersOpen} onClose={() => setMembersOpen(false)} title={`Members (${members.length})`} members={members} />
    {unresolvedCount > 0 && <Alert severity="warning" sx={{ width: 640, maxWidth: '100%', margin: '0 auto 20px' }}>
      {unresolvedCount} {scope.toLowerCase()} {unresolvedCount === 1 ? 'member has' : 'members have'} no confirmed {targetLabel} identity yet. Their publications are absent from these partial results.
    </Alert>}
  </>;
}

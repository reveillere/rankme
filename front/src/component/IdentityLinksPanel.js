import { useCallback, useEffect, useRef, useState } from 'react';

// Material-UI Components
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import CircularProgress from '@mui/material/CircularProgress';
import Alert from '@mui/material/Alert';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';

import { fetchIdentityLinks, fetchStructureIdentityResolution, fetchTeamIdentityResolution, deleteIdentityLink, importIdentityLinks, postIdentityLink } from '../identityResolution';
import { IdentityLinkDialog } from './IdentityLinkDialog';
import { ExportButton } from './ExportButton';
import { ImportButton } from './ImportButton';
import { HelpButton } from './HelpButton';
import { downloadTextFile } from '../exportPublications';

// Management panel for personLinks (api/src/identityResolution.js), opened
// from Team.js/Structure.js's own "Manage identity links" icon next to the
// pre-existing "View members" eye icon (MemberListDialog.js). Unlike that
// read-only member list, this one only ever shows members that already
// HAVE a confirmed link on file -- fetchIdentityLinks queries personLinks
// filtered down to this team/structure's own idHals/pids, it is not the
// membership list itself -- and lets the maintainer delete a link or bulk
// import/export the set, without going back through the cross-check flow
// that originally created each one.
//
// GET /api/identity/links only ever returns {idHal, pid, source, createdAt}
// -- no name, and deliberately not extended to fetch one (a name lookup for
// an arbitrary pid/idHal has no cheap batched form on either side -- see
// identityResolution.js's own module header on dblp's ORCID coverage for the
// kind of per-id cost that would imply). `resolveName`, if the caller
// supplies one, is instead a pure client-side lookup into a name map
// Team.js/Structure.js already built from data they'd loaded anyway (team
// member labels, or a structure's publications-derived idHal->name map --
// see MemberListDialog.js's own comment) -- never a network call from here.
// Optional and defensive (`resolveName?.(...)`) so a caller that hasn't
// built one yet still renders, just without names.
export function IdentityLinksPanel({ open, onClose, idHals = [], pids = [], resolveName, structId, teamSource, teamMembers, onViewResults, onLinksChanged }) {
  const [links, setLinks] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [error, setError] = useState(null);
  const [linkingMember, setLinkingMember] = useState(null);
  const importFileInputRef = useRef();
  const importCsvFileInputRef = useRef();

  // Keyed off the joined id lists rather than the arrays themselves: Team.js/
  // Structure.js already memoize the arrays they pass down, but joining here
  // too means this doesn't have to trust every future caller to do the same.
  const idHalsKey = idHals.join(',');
  const pidsKey = pids.join(',');
  const refresh = useCallback(() => {
    setLinks(null);
    setResolution(null);
    setError(null);
    const load = structId
      ? fetchStructureIdentityResolution(structId).then(members => {
        setResolution(members);
        return members.filter(member => member.resolved).map(member => ({
          idHal: member.idHal,
          pid: member.resolved.pid,
          source: member.resolved.source,
          name: member.name,
          dblpName: member.resolved.name,
        }));
      })
      : teamSource ? fetchTeamIdentityResolution({ source: teamSource, members: teamMembers }).then(members => {
        setResolution(members);
        return members.filter(member => member.resolved).map(member => teamSource === 'hal'
          ? { idHal: member.idHal, pid: member.resolved.pid, source: member.resolved.source, name: member.name, dblpName: member.resolved.name }
          : { idHal: member.resolved.idHal, pid: member.pid, source: member.resolved.source, name: member.resolved.name, dblpName: member.name });
      }) : fetchIdentityLinks({ idHals, pids });
    load
      .then(setLinks)
      .catch(err => setError(err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idHalsKey, pidsKey, structId, teamSource, teamMembers]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const handleDelete = (idHal) => {
    deleteIdentityLink(idHal).then(() => { onLinksChanged?.(); refresh(); }).catch(err => setError(err.message));
  };

  const handleConfirmCandidate = (member, candidate) => {
    const idHal = teamSource === 'dblp' ? candidate.idHal : member.idHal;
    const pid = teamSource === 'dblp' ? member.pid : candidate.pid;
    postIdentityLink({ idHal, pid }).then(() => { onLinksChanged?.(); refresh(); }).catch(err => setError(err.message));
  };

  const handleManualLink = (pid) => {
    const idHal = teamSource === 'dblp' ? pid : linkingMember?.idHal;
    const targetPid = teamSource === 'dblp' ? linkingMember?.pid : pid;
    if (!idHal || !targetPid) return;
    setLinkingMember(null);
    postIdentityLink({ idHal, pid: targetPid }).then(() => { onLinksChanged?.(); refresh(); }).catch(err => setError(err.message));
  };

  // Same mechanics as Teams.js's own handleExportTeams -- a client-side
  // Blob download, no server round trip (the data's already in hand from
  // the last fetch).
  const handleExportJson = () => {
    const blob = new Blob([JSON.stringify(links, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'rankme-identity-links.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };
  const handleExportMarkdown = () => downloadTextFile('rankme-identity-links.md', `# Identity links\n\n${links.map(link => `- ${link.name || link.idHal} (idHal: ${link.idHal}) → ${link.dblpName || ''} (pid: ${link.pid})`).join('\n')}\n`, 'text/markdown;charset=utf-8;');
  const handleExportCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    downloadTextFile('rankme-identity-links.csv', ['idHal,pid', ...links.map(link => [link.idHal, link.pid].map(quote).join(','))].join('\n'), 'text/csv;charset=utf-8;');
  };

  // Same mechanics as Teams.js's own handleImportTeamsFile -- accepts either
  // a bare exported array or a re-uploaded single-object file, so a file
  // this same panel just exported (or a hand-edited subset of it) imports
  // back in without special-casing. Server-side validation (importLinksCore)
  // is what actually screens each entry -- this only needs to get the file
  // into an array to send.
  const handleImportFile = (e, format) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed;
      try {
        if (format === 'csv') {
          parsed = String(reader.result).trim().split(/\r?\n/).slice(1).filter(Boolean).map(line => {
            const cells = [];
            line.replace(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g, (_, quoted, plain) => {
              cells.push((quoted ?? plain).replaceAll('""', '"'));
              return '';
            });
            return { idHal: cells[0], pid: cells[1] };
          });
        } else {
          parsed = JSON.parse(String(reader.result));
        }
      } catch {
        setError('Invalid JSON file');
        return;
      }
      const list = Array.isArray(parsed) ? parsed : [parsed];
      importIdentityLinks(list)
        .then(() => { onLinksChanged?.(); refresh(); })
        .catch(err => setError(err.message));
    };
    reader.readAsText(file);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}><span>Identity links</span><HelpButton title="Identity links help" sections={[{ title: 'Confirm or select', description: 'Confirm only when both identities belong to the same person. Select lets you replace an incorrect proposal.' }, { title: 'Import: JSON', description: 'Import an exported JSON file or a list of HAL/DBLP identity pairs.', example: '[{ "idHal": "laurent-reveillere", "pid": "11/1262" }]' }, { title: 'Import: CSV', description: 'Import a CSV with only the two identity columns idHal and pid.', example: 'idHal,pid\nlaurent-reveillere,11/1262' }, { title: 'Export formats', description: 'Markdown is a readable report, JSON preserves the links, and CSV contains only idHal and pid for reimport or spreadsheets.' }]} /></Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          <ExportButton onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={!links || links.length === 0} />
          <ImportButton title="Import identity links" onImportJson={() => importFileInputRef.current?.click()} onImportCsv={() => importCsvFileInputRef.current?.click()} />
        </Box>
      </DialogTitle>
      <DialogContent dividers>
        {error && <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>{error}</Alert>}

        <input ref={importFileInputRef} type="file" accept=".json,application/json" hidden onChange={e => handleImportFile(e, 'json')} />
        <input ref={importCsvFileInputRef} type="file" accept=".csv,text/csv" hidden onChange={e => handleImportFile(e, 'csv')} />

        {links === null ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
            <CircularProgress size={28} />
          </Box>
        ) : resolution && resolution.filter(member => !member.resolved).length > 0 ? (
          <>
            <Typography variant="h6" sx={{ mb: 1 }}>
              Members without a resolved DBLP identity ({resolution.filter(member => !member.resolved).length})
            </Typography>
            {resolution.filter(member => !member.resolved).map(member => (
              <UnresolvedStructureMemberRow
                key={member.idHal || member.pid}
                member={member}
                inverse={teamSource === 'dblp'}
                onLink={() => setLinkingMember(member)}
                onConfirmCandidate={handleConfirmCandidate}
              />
            ))}
            {links.length > 0 && <>
              <Typography variant="h6" sx={{ mt: 3, mb: 1 }}>Confirmed identity links ({links.length})</Typography>
              <IdentityLinksList
                links={links}
                resolveName={resolveName}
                onDelete={handleDelete}
              />
            </>}
          </>
        ) : links.length === 0 ? (
          <Typography variant="body2" color="text.secondary">No confirmed identity link for these members yet.</Typography>
        ) : (
          <>
            {resolution && <Typography variant="h6" sx={{ mb: 1 }}>Confirmed identity links ({links.length})</Typography>}
            <IdentityLinksList links={links} resolveName={resolveName} onDelete={handleDelete} />
          </>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onViewResults || onClose}>{onViewResults ? 'View partial results' : 'Close'}</Button>
      </DialogActions>
      <IdentityLinkDialog
        open={linkingMember !== null}
        onClose={() => setLinkingMember(null)}
        onConfirm={handleManualLink}
        direction={teamSource === 'dblp' ? 'hal' : 'dblp'}
        title={`Link ${teamSource === 'dblp' ? 'HAL' : 'DBLP'} identity`}
        description={linkingMember && `Find ${linkingMember.name || linkingMember.idHal || linkingMember.pid}'s identity.`}
        suggestion={linkingMember?.name ? { name: linkingMember.name } : undefined}
      />
    </Dialog>
  );
}

// Same interaction as the unresolved-members panel in CrossCheckStructure:
// an unambiguous candidate can be confirmed in one click; otherwise the
// regular DBLP search dialog opens with the member name pre-filled.
function UnresolvedStructureMemberRow({ member, inverse, onLink, onConfirmCandidate }) {
  const singleCandidate = member.candidates.length === 1 ? member.candidates[0] : null;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 1 }}>
      <Typography variant="body2" sx={{ flex: 1 }}>
        <strong>{member.name || member.idHal || member.pid}</strong> <span style={{ fontStyle: 'italic' }}>({inverse ? 'pid' : 'idHal'}: {inverse ? member.pid : member.idHal})</span>
        {singleCandidate && <><br /><HelpOutlineIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />candidate: {singleCandidate.name || singleCandidate.pid || singleCandidate.idHal} <span style={{ fontStyle: 'italic' }}>({inverse ? 'idHal' : 'pid'}: {inverse ? singleCandidate.idHal : singleCandidate.pid})</span></>}
        {!singleCandidate && member.candidates.length > 0 && <><br /><HelpOutlineIcon fontSize="inherit" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />{member.candidates.length} DBLP candidates found (unconfirmed)</>}
      </Typography>
      {singleCandidate ? (
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button size="small" variant="contained" onClick={() => onConfirmCandidate(member, singleCandidate)} sx={{ textTransform: 'none' }}>Confirm</Button>
          <Button size="small" variant="outlined" onClick={onLink} sx={{ textTransform: 'none' }}>Select</Button>
        </Box>
      ) : (
        <Button size="small" variant="outlined" onClick={onLink} sx={{ textTransform: 'none' }}>Select</Button>
      )}
    </Box>
  );
}

function IdentityLinksList({ links, resolveName, onDelete }) {
  return <List dense disablePadding>{links.map(link => {
    const idHalName = link.name || resolveName?.(link.idHal);
    const pidName = resolveName?.(link.pid);
    return <ListItem key={link.idHal} disableGutters sx={{ py: 1, display: 'flex', gap: 1, alignItems: 'center' }}>
      <Typography variant="body2" sx={{ flex: 1 }}>
        <strong>{idHalName || link.idHal}</strong> <span style={{ fontStyle: 'italic' }}>(idHal: {link.idHal})</span>
        <br /><LinkIcon fontSize="inherit" color="action" sx={{ verticalAlign: 'text-bottom', mr: 0.5 }} />
        {link.dblpName || pidName ? `${link.dblpName || pidName} ` : ''}<span style={{ fontStyle: 'italic' }}>(pid: {link.pid})</span>
        <span style={{ color: '#8a8f94', fontStyle: 'italic' }}> ({link.source})</span>
      </Typography>
      <Tooltip title="Delete link"><IconButton size="small" onClick={() => onDelete(link.idHal)} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton></Tooltip>
    </ListItem>;
  })}</List>;
}

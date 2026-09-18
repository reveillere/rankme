import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, List, ListItem, TextField, Tooltip, Typography } from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import LinkIcon from '@mui/icons-material/Link';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { fetchIdentityLinks, fetchStructureIdentityResolution, fetchTeamIdentityResolution, deleteIdentityLink, importIdentityLinks, postIdentityLink } from '../identityResolution';
import { LINKS_KEY, personalDataFile } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { IdentityLinkDialog } from './IdentityLinkDialog';
import { ExportButton } from './ExportButton';
import { ImportButton } from './ImportButton';
import { downloadTextFile } from '../exportPublications';

export function IdentityLinksPanel({ open, onClose, idHals = [], pids = [], resolveName, structId, teamSource, teamMembers, onViewResults, onLinksChanged, all = false }) {
  const [links, setLinks] = useState(null);
  const [resolution, setResolution] = useState(null);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [linkingMember, setLinkingMember] = useState(null);
  const [draftHal, setDraftHal] = useState('');
  const [draftPid, setDraftPid] = useState('');
  const importFileInputRef = useRef();
  const importCsvFileInputRef = useRef();
  const version = usePersonalDataVersion(LINKS_KEY);
  const idHalsKey = JSON.stringify(idHals);
  const pidsKey = JSON.stringify(pids);
  const membersKey = JSON.stringify(teamMembers || []);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLinks(null);
    setResolution(null);
    const load = async () => {
      const members = structId ? await fetchStructureIdentityResolution(structId)
        : teamSource ? await fetchTeamIdentityResolution({ source: teamSource, members: JSON.parse(membersKey) }) : null;
      const effective = members ? members.filter(member => member.resolved).map(member => teamSource === 'dblp'
        ? { idHal: member.resolved.idHal, pid: member.pid, source: member.resolved.source, name: member.resolved.name, dblpName: member.name }
        : { idHal: member.idHal, pid: member.resolved.pid, source: member.resolved.source, name: member.name, dblpName: member.resolved.name })
        : await fetchIdentityLinks(all ? undefined : { idHals: JSON.parse(idHalsKey), pids: JSON.parse(pidsKey) });
      if (!cancelled) { setResolution(members); setLinks(effective); }
    };
    load().catch(err => { if (!cancelled) { setError(err.message); setLinks([]); } });
    return () => { cancelled = true; };
  }, [open, structId, teamSource, membersKey, idHalsKey, pidsKey, all, version]);

  const scope = all ? undefined : structId
    ? { idHals: resolution?.map(member => member.idHal) || idHals }
    : teamSource ? (teamSource === 'hal' ? { idHals: (teamMembers || []).map(member => member.id) } : { pids: (teamMembers || []).map(member => member.id) })
      : { idHals, pids };
  const scopeInfo = all ? { type: 'all' } : structId ? { type: 'structure', id: structId }
    : teamSource ? { type: 'team', source: teamSource } : { type: 'author', idHal: idHals[0], pid: pids[0] };
  const filename = `rankme-identity-links-${scopeInfo.type}-${String(structId || pids[0] || idHals[0] || 'selection').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const changed = () => { setError(null); onLinksChanged?.(); };
  const handleDelete = idHal => deleteIdentityLink(idHal).then(changed).catch(err => setError(err.message));
  const save = link => importIdentityLinks([link], scope).then(changed).catch(err => setError(err.message));
  const handleConfirmCandidate = (member, candidate) => save({
    idHal: teamSource === 'dblp' ? candidate.idHal : member.idHal,
    pid: teamSource === 'dblp' ? member.pid : candidate.pid,
  });
  const handleManualLink = selected => {
    const link = teamSource === 'dblp' ? { idHal: selected, pid: linkingMember.pid } : { idHal: linkingMember.idHal, pid: selected };
    setLinkingMember(null);
    save(link);
  };
  const handleExportJson = () => downloadTextFile(filename + '.json', JSON.stringify(personalDataFile('identity-links', links.map(({ idHal, pid }) => ({ idHal, pid })), scopeInfo), null, 2), 'application/json');
  const handleExportMarkdown = () => downloadTextFile(filename + '.md', `# Identity links\n\n${links.map(link => `- ${link.idHal} → ${link.pid}`).join('\n')}\n`, 'text/markdown;charset=utf-8;');
  const handleExportCsv = () => {
    const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
    downloadTextFile(filename + '.csv', ['idHal,pid', ...links.map(link => [link.idHal, link.pid].map(quote).join(','))].join('\n'), 'text/csv;charset=utf-8;');
  };
  const handleImportFile = async (event, format) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    try {
      if (file.size > 5_000_000) throw new Error('File too large (maximum 5 MB).');
      const content = await file.text();
      let parsed;
      if (format === 'csv') {
        const lines = content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
        if (lines.shift()?.replaceAll('"', '') !== 'idHal,pid') throw new Error('Expected CSV columns idHal,pid.');
        parsed = lines.filter(Boolean).map(line => {
          const cells = [];
          line.replace(/(?:^|,)(?:"((?:[^"]|"")*)"|([^,]*))/g, (_, quoted, plain) => { cells.push((quoted ?? plain).replaceAll('""', '"')); return ''; });
          if (cells.length !== 2) throw new Error('Expected two columns per identity link.');
          return { idHal: cells[0], pid: cells[1] };
        });
      } else {
        parsed = JSON.parse(content);
        if (parsed?.idHal && parsed?.pid) parsed = [parsed];
      }
      const result = await importIdentityLinks(parsed, scope);
      changed();
      setNotice(`${result.imported} links imported into this browser. Other links were kept.`);
    } catch (err) { setError(err.message); }
  };

  return <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
    <DialogTitle sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
      {all ? 'My identity links' : 'Identity links for this ' + scopeInfo.type}
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <ExportButton updateUrl={false} onExportMarkdown={handleExportMarkdown} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={!links?.length} />
        <ImportButton title="Import identity links" disabled={links === null || (structId && resolution === null)} onImportJson={() => importFileInputRef.current?.click()} onImportCsv={() => importCsvFileInputRef.current?.click()} />
      </Box>
    </DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" sx={{ mb: 2 }}>Your choices are saved in this browser only. Export JSON or CSV to share the links for this selection. Import merges the file into your local links; it never changes another visitor’s choices.</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 2 }}>ORCID suggestions are automatic. Export includes the displayed links; importing them saves them as personal choices. Deleting a personal choice restores automatic suggestions.</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      <input ref={importFileInputRef} type="file" accept=".json,application/json" hidden onChange={event => handleImportFile(event, 'json')} />
      <input ref={importCsvFileInputRef} type="file" accept=".csv,text/csv" hidden onChange={event => handleImportFile(event, 'csv')} />
      {links === null ? <CircularProgress size={28} /> : <>
        {resolution?.filter(member => !member.resolved).map(member => <UnresolvedStructureMemberRow key={member.idHal || member.pid} member={member} inverse={teamSource === 'dblp'} onLink={() => setLinkingMember(member)} onConfirmCandidate={handleConfirmCandidate} />)}
        <IdentityLinksList links={links} resolveName={resolveName} onDelete={handleDelete} onSave={link => postIdentityLink(link).then(changed).catch(err => setError(err.message))} />
        {!links.length && <Typography color="text.secondary">No saved identity links in this selection.</Typography>}
        {!structId && !teamSource && <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
          <TextField size="small" label="HAL id" value={draftHal} onChange={event => setDraftHal(event.target.value)} />
          <TextField size="small" label="DBLP PID" value={draftPid} onChange={event => setDraftPid(event.target.value)} />
          <Button onClick={() => save({ idHal: draftHal, pid: draftPid })} disabled={!draftHal.trim() || !draftPid.trim()}>Save</Button>
        </Box>}
      </>}
    </DialogContent>
    <DialogActions><Button onClick={onViewResults || onClose}>{onViewResults ? 'View results' : 'Close'}</Button></DialogActions>
    <IdentityLinkDialog open={linkingMember !== null} onClose={() => setLinkingMember(null)} onConfirm={handleManualLink} direction={teamSource === 'dblp' ? 'hal' : 'dblp'} title="Link identity" description={linkingMember && `Find ${linkingMember.name || linkingMember.idHal || linkingMember.pid}'s identity.`} suggestion={linkingMember?.name ? { name: linkingMember.name } : undefined} />
  </Dialog>;
}

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

function IdentityLinksList({ links, resolveName, onDelete, onSave }) {
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
      {link.source === 'local' ? <Tooltip title="Delete personal link"><IconButton size="small" onClick={() => onDelete(link.idHal)} aria-label="delete"><DeleteIcon fontSize="small" /></IconButton></Tooltip> : <Button size="small" onClick={() => onSave(link)}>Save locally</Button>}
    </ListItem>;
  })}</List>;
}

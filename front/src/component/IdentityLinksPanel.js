import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Box, Button, CircularProgress, Dialog, DialogActions, DialogContent, DialogTitle, List, Typography } from '@mui/material';
import { fetchIdentityLinkMembers, identityLinkFromMember, deleteIdentityLink, clearIdentityLinks, importIdentityLinks } from '../identityResolution';
import { LINKS_KEY, listIdentityLinks, personalDataFile } from '../personalData';
import { usePersonalDataVersion } from '../usePersonalDataVersion';
import { IdentityLinkDialog } from './IdentityLinkDialog';
import { IdentityLinkRow } from './IdentityLinkRow';
import { ExportButton } from './ExportButton';
import { ImportButton } from './ImportButton';
import { downloadTextFile } from '../exportPublications';

export function IdentityLinksPanel({ open, onClose, idHals = [], pids = [], resolveName, structId, teamSource, teamMembers, onViewResults, all = false }) {
  const [resolution, setResolution] = useState(null);
  const [error, setError] = useState(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [notice, setNotice] = useState(null);
  const [linkingMember, setLinkingMember] = useState(null);
  const [clearOpen, setClearOpen] = useState(false);
  const importFileInputRef = useRef();
  const importCsvFileInputRef = useRef();
  const version = usePersonalDataVersion(LINKS_KEY);
  const source = all ? 'dblp' : structId ? 'hal' : teamSource || (pids.length ? 'dblp' : 'hal');
  const membersKey = JSON.stringify(teamMembers || (source === 'dblp' ? pids : idHals).map(id => ({ id, name: resolveName?.(id) })));
  const links = resolution?.map(member => identityLinkFromMember(member, source)).filter(Boolean);
  const linkingSuggestion = useMemo(() => linkingMember?.name ? { name: linkingMember.name } : undefined, [linkingMember]);
  // Scoped views already know the member. The global view first selects one,
  // then continues through the very same counterpart search and save action.
  const selectingMember = linkingMember !== null && !linkingMember.idHal && !linkingMember.pid;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(null);
    setLinkingMember(null);
    setClearOpen(false);
    setResolution(null);
    const load = async () => {
      const members = await fetchIdentityLinkMembers({ all, structId, source, members: JSON.parse(membersKey) });
      if (!cancelled) setResolution(members);
    };
    load().catch(err => { if (!cancelled) setError(err.message); });
    return () => { cancelled = true; };
  }, [open, structId, source, membersKey, all, version, loadAttempt]);

  const scope = all ? undefined : structId
    ? { idHals: resolution?.map(member => member.idHal) || idHals }
    : { [source === 'dblp' ? 'pids' : 'idHals']: JSON.parse(membersKey).map(member => member.id) };
  const scopeInfo = all ? { type: 'all' } : structId ? { type: 'structure', id: structId }
    : teamSource ? { type: 'team', source: teamSource } : { type: 'author', idHal: idHals[0], pid: pids[0] };
  const filename = `rankme-identity-links-${scopeInfo.type}-${String(structId || pids[0] || idHals[0] || 'selection').replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const personalLinkCount = resolution === null ? 0 : listIdentityLinks(scope).length;
  const changed = () => setError(null);
  const handleClear = async () => {
    setClearOpen(false);
    try {
      await clearIdentityLinks(scope);
      changed();
      setNotice('Personal links cleared for this selection. Automatic suggestions are available again.');
    } catch (err) { setError(err.message); }
  };
  const handleDelete = member => deleteIdentityLink(identityLinkFromMember(member, source).idHal).then(changed).catch(err => setError(err.message));
  const save = link => importIdentityLinks([link], scope).then(changed).catch(err => setError(err.message));
  const handleConfirmCandidate = (member, candidate) => save(identityLinkFromMember({ ...member, resolved: candidate }, source));
  const handleManualLink = (selected, details) => {
    if (selectingMember) {
      setLinkingMember({ pid: selected, name: details?.name });
      return;
    }
    handleConfirmCandidate(linkingMember, { [source === 'dblp' ? 'idHal' : 'pid']: selected });
    setLinkingMember(null);
  };
  const handleExportJson = () => downloadTextFile(filename + '.json', JSON.stringify(personalDataFile('identity-links', links.map(({ idHal, pid }) => ({ idHal, pid })), scopeInfo), null, 2), 'application/json');
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
        <ExportButton updateUrl={false} onExportJson={handleExportJson} onExportCsv={handleExportCsv} disabled={!links?.length} />
        <ImportButton title="Import identity links" disabled={resolution === null} onImportJson={() => importFileInputRef.current?.click()} onImportCsv={() => importCsvFileInputRef.current?.click()} />
      </Box>
    </DialogTitle>
    <DialogContent dividers>
      <Typography variant="body2" sx={{ mb: 2 }}>Your choices are saved in this browser only. Export JSON or CSV to share the links for this selection. Import merges the file into your local links; it never changes another visitor’s choices.</Typography>
      <Typography variant="caption" display="block" sx={{ mb: 2 }}>ORCID suggestions are automatic. Export includes the displayed links; importing them saves them as personal choices. Deleting a personal choice restores automatic suggestions.</Typography>
      {error && <Alert severity="error" sx={{ mb: 2 }} action={resolution === null ? <Button color="inherit" size="small" onClick={() => setLoadAttempt(attempt => attempt + 1)}>Retry</Button> : undefined}>{error}</Alert>}
      {notice && <Alert severity="success" sx={{ mb: 2 }}>{notice}</Alert>}
      <input ref={importFileInputRef} type="file" accept=".json,application/json" hidden onChange={event => handleImportFile(event, 'json')} />
      <input ref={importCsvFileInputRef} type="file" accept=".csv,text/csv" hidden onChange={event => handleImportFile(event, 'csv')} />
      {resolution === null ? !error && <CircularProgress size={28} /> : <>
        <List dense disablePadding>{resolution.map(member => <IdentityLinkRow
          key={member.idHal || member.pid}
          member={member}
          source={source}
          onSelect={setLinkingMember}
          onConfirm={handleConfirmCandidate}
          onDelete={handleDelete}
        />)}</List>
        {!resolution.length && !error && <Typography color="text.secondary">No saved identity links in this selection.</Typography>}
        {all && <Button variant="outlined" sx={{ mt: 2 }} onClick={() => setLinkingMember({})}>Add identity link</Button>}
      </>}
    </DialogContent>
    <DialogActions sx={{ justifyContent: 'space-between' }}>
      <Button color="error" disabled={!personalLinkCount} onClick={() => setClearOpen(true)}>Reset all</Button>
      <Button onClick={onViewResults || onClose}>{onViewResults ? 'View results' : 'Close'}</Button>
    </DialogActions>
    <Dialog open={clearOpen} onClose={() => setClearOpen(false)} maxWidth="xs" fullWidth>
      <DialogTitle>Reset all personal identity links?</DialogTitle>
      <DialogContent>
        <Typography>This will delete {personalLinkCount} personal {personalLinkCount === 1 ? 'link' : 'links'} {all ? 'saved in this browser' : `for this ${scopeInfo.type}`}. Automatic suggestions will remain available.</Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => setClearOpen(false)}>Cancel</Button>
        <Button color="error" disabled={!personalLinkCount} onClick={handleClear}>Reset all</Button>
      </DialogActions>
    </Dialog>
    <IdentityLinkDialog
      open={linkingMember !== null}
      onClose={() => setLinkingMember(null)}
      onConfirm={handleManualLink}
      direction={selectingMember ? 'dblp' : source === 'dblp' ? 'hal' : 'dblp'}
      title="Link identity"
      description={selectingMember ? 'Find the author on DBLP, then select their HAL identity.' : linkingMember && `Find ${linkingMember.name || linkingMember.idHal || linkingMember.pid}'s identity.`}
      suggestion={linkingSuggestion}
    />
  </Dialog>;
}

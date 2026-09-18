import { useState, useEffect } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Divider from '@mui/material/Divider';
import RadioGroup from '@mui/material/RadioGroup';
import Radio from '@mui/material/Radio';
import Select from '@mui/material/Select';
import MenuItem from '@mui/material/MenuItem';
import Chip from '@mui/material/Chip';
import TextField from '@mui/material/TextField';
import Link from '@mui/material/Link';
import EditIcon from '@mui/icons-material/Edit';

import { getUseCommunityOverrides, setUseCommunityOverrides } from '../matchOverrides';
import { listProfiles, axesForReference, createProfile } from '../customRankings';
import { IdentityLinksButton } from './IdentityLinksButton';
import { CrosscheckDecisionsButton } from './CrosscheckDecisionsButton';
import { useFilterSettings } from '../FilterSettingsContext';

const REFERENCE_LABEL = { core: 'CORE', sjr: 'SJR', ccf: 'CCF' };

// A literal, profile-independent radio value -- the axis's real source
// (conferenceSource/journalSource) only becomes a concrete `custom:${id}`
// once an actual profile is chosen or created below (see CustomAxisSection).
// Distinguishing "the Custom radio is checked" from "which profile" this way
// is what lets one radio stand for however many profiles exist, instead of
// one radio per profile (which stopped scaling past a couple of them).
const CUSTOM_RADIO_VALUE = 'custom';

// A dedicated MenuItem value (never a real profile id, which are
// crypto.randomUUID() strings and so can never collide with this) that the
// Select below treats as "open the inline creation form instead of
// selecting a profile".
const CREATE_SENTINEL = '__create__';

// The Select + inline "create new profile" form shown under a "Custom"
// radio once it's checked -- identical shape for both axes, parameterized
// by which profiles are eligible (already filtered by axesForReference) and
// which two reference rankings make sense to offer when creating one from
// here (CORE/CCF for conferences, SJR/CCF for journals -- the third
// reference is never relevant on this axis, so it's simply not offered,
// unlike MyCustomRankingsDialog.js's own create form which manages every
// profile regardless of axis and so offers all three).
function CustomAxisSection({ source, onSourceChange, profiles, creationReferences }) {
  const activeProfileId = source.startsWith('custom:') ? source.slice('custom:'.length) : '';
  // profiles.length === 0 forces the creation form regardless of `creating`
  // (there is nothing yet for a Select to list) -- `creating` only matters
  // once at least one profile already exists, as the "+ Create new
  // profile…" escape hatch out of the Select.
  const [creating, setCreating] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [draftReference, setDraftReference] = useState(creationReferences[0]);

  const handleSelectChange = (e) => {
    const value = e.target.value;
    if (value === CREATE_SENTINEL) { setCreating(true); return; }
    onSourceChange(`custom:${value}`);
  };

  const handleCreate = () => {
    if (!draftName.trim()) return;
    const profile = createProfile(draftName, draftReference);
    onSourceChange(`custom:${profile.id}`);
    setCreating(false);
    setDraftName('');
  };

  if (profiles.length === 0 || creating) {
    // creationReferences (e.g. ['core', 'ccf'] on the Conference axis) drives
    // the wording too, not just which radio options are offered below -- so
    // this reads "starting from CORE or CCF" here and "starting from SJR or
    // CCF" on the Journal axis, the same explanation MyCustomRankingsDialog.js
    // gives its own (axis-agnostic, all-three-references) create form.
    const referenceList = creationReferences.map(ref => REFERENCE_LABEL[ref]).join(' or ');
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5, ml: 4, mt: 0.5, mb: 1.5 }}>
        <Typography variant="caption" color="text.secondary">
          Define your own ranking by starting from {referenceList} and overriding specific venues by hand.
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {profiles.length === 0 ? 'No custom ranking exists yet for this axis -- create one:' : 'New custom ranking:'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            placeholder="Name…"
            value={draftName}
            onChange={e => setDraftName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleCreate(); }}
          />
          <RadioGroup row value={draftReference} onChange={e => setDraftReference(e.target.value)}>
            {creationReferences.map(ref => (
              <FormControlLabel key={ref} value={ref} control={<Radio size="small" />} label={<Typography variant="body2">{REFERENCE_LABEL[ref]}</Typography>} />
            ))}
          </RadioGroup>
          <Button size="small" onClick={handleCreate} disabled={!draftName.trim()}>Create</Button>
          {profiles.length > 0 && <Button size="small" onClick={() => setCreating(false)}>Cancel</Button>}
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ ml: 4, mt: 0.5, mb: 1.5 }}>
      <Select size="small" value={activeProfileId} onChange={handleSelectChange} displayEmpty sx={{ minWidth: 240 }}>
        {profiles.map(p => (
          <MenuItem key={p.id} value={p.id}>
            {/* base: CORE/SJR/CCF -- matters most here since this axis's
                eligible list can mix two different references at once (e.g.
                Conference shows both core- and ccf-referenced profiles
                together), unlike MyCustomRankingsDialog.js's own per-profile
                row which only ever needs this to distinguish profiles that
                already differ by name too. MUI's Select mirrors the selected
                MenuItem's own children when closed, so this also renders in
                the collapsed state -- no renderValue override needed. */}
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <Typography variant="body2" sx={{ flex: 1 }}>{p.name}</Typography>
              <Chip size="small" variant="outlined" label={`base: ${REFERENCE_LABEL[p.reference] ?? p.reference}`} />
            </Box>
          </MenuItem>
        ))}
        <Divider />
        <MenuItem value={CREATE_SENTINEL}>+ Create new profile…</MenuItem>
      </Select>
    </Box>
  );
}

export function SettingsDialog({ open, onClose, onManageCustomRankings }) {
  // Not part of FilterSettingsContext: that context is for chart/list
  // filtering (re-applied reactively as you change it), while this is a
  // one-off "trust the crowd or not" preference, read fresh by each
  // RankBadge only when it starts loading its shared-overrides fetch (see
  // RankBadge.js) -- plain localStorage is enough, matching e.g. About.js's
  // "don't show this again" checkbox.
  const [useCommunityOverrides, setUseCommunityOverridesState] = useState(getUseCommunityOverrides);
  const handleCommunityOverridesChange = (e) => {
    setUseCommunityOverridesState(e.target.checked);
    setUseCommunityOverrides(e.target.checked);
  };

  // Ranking sources DO live in FilterSettingsContext (unlike
  // useCommunityOverrides above): switching either needs to be visible
  // everywhere at once -- every open tab's stream, the toolbar badge, the
  // category filter popover -- without a page reload, which only a shared
  // reactive value (not a plain localStorage read) can do.
  const { conferenceSource, setConferenceSource, journalSource, setJournalSource } = useFilterSettings();

  // True only in the transitional moment between checking the "Custom"
  // radio and an actual profile existing to point it at: with zero eligible
  // profiles for this axis, there is nothing concrete for conferenceSource/
  // journalSource to become yet (see the onChange handlers below), so
  // without this the radio itself would immediately un-check the instant
  // it was clicked. This is a deliberate, narrow inconsistency -- the radio
  // reads as "on" for a moment while the real active source hasn't changed
  // -- rather than engineering around it (e.g. faking a source value that
  // doesn't resolve to anything real). Cleared the moment a concrete
  // custom:* source is actually set (profile picked or created), or if the
  // user picks a different radio instead.
  const [conferencePendingCustom, setConferencePendingCustom] = useState(false);
  const [journalPendingCustom, setJournalPendingCustom] = useState(false);

  const handleConferenceSourceChange = (e) => {
    const value = e.target.value;
    if (value !== CUSTOM_RADIO_VALUE) { setConferencePendingCustom(false); setConferenceSource(value); return; }
    if (conferenceSource.startsWith('custom:')) return; // already on some profile -- nothing to resolve
    if (conferenceProfiles.length > 0) setConferenceSource(`custom:${conferenceProfiles[0].id}`);
    else setConferencePendingCustom(true);
  };
  const handleJournalSourceChange = (e) => {
    const value = e.target.value;
    if (value !== CUSTOM_RADIO_VALUE) { setJournalPendingCustom(false); setJournalSource(value); return; }
    if (journalSource.startsWith('custom:')) return;
    if (journalProfiles.length > 0) setJournalSource(`custom:${journalProfiles[0].id}`);
    else setJournalPendingCustom(true);
  };
  // CustomAxisSection's own onSourceChange (a profile picked from the
  // Select, or just created) always clears the pending flag too -- by the
  // time it fires, conferenceSource/journalSource itself already satisfies
  // the 'custom:' check below, so this is belt-and-suspenders tidiness, not
  // load-bearing.
  const handleConferenceCustomResolved = (value) => { setConferencePendingCustom(false); setConferenceSource(value); };
  const handleJournalCustomResolved = (value) => { setJournalPendingCustom(false); setJournalSource(value); };

  // The edition/year actually being used for CORE/SJR right now -- fetched
  // fresh each time this dialog opens rather than hardcoded, so it can
  // never drift out of date the way a string someone has to remember to
  // bump by hand would (see routes.js's /ranking-editions, which reads
  // each portal's own live in-process state).
  const [editions, setEditions] = useState(null);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch('/api/ranking-editions').then(r => r.json()).then(data => { if (!cancelled) setEditions(data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [open]);

  // A custom ranking profile (customRankings.js) is offered here as a
  // single "Custom" radio per axis (not one per profile -- see
  // CustomAxisSection) -- but only on the axis(es) its own reference
  // ranking makes it eligible for (axesForReference): a 'core'-referenced
  // profile only under Conferences, 'sjr' only under Journals, 'ccf' under
  // both, mirroring CORE/SJR/CCF's own fixed axis assignments. Kept live
  // (not just refreshed on open) so creating/renaming/deleting a profile
  // from MyCustomRankingsDialog.js -- reachable from this same dialog,
  // possibly open at the same time in another window -- is reflected here
  // without needing this dialog to be closed and reopened.
  const [profiles, setProfiles] = useState(() => listProfiles());
  useEffect(() => {
    const refresh = () => setProfiles(listProfiles());
    window.addEventListener('rankme:customrankingchange', refresh);
    return () => window.removeEventListener('rankme:customrankingchange', refresh);
  }, []);
  const conferenceProfiles = profiles.filter(p => axesForReference(p.reference).includes('conference'));
  const journalProfiles = profiles.filter(p => axesForReference(p.reference).includes('journal'));

  const conferenceRadioValue = conferenceSource.startsWith('custom:') || conferencePendingCustom ? CUSTOM_RADIO_VALUE : conferenceSource;
  const journalRadioValue = journalSource.startsWith('custom:') || journalPendingCustom ? CUSTOM_RADIO_VALUE : journalSource;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Preferences</DialogTitle>
      <DialogContent>
        <Typography variant="subtitle1" gutterBottom>Conference ranking</Typography>
        <RadioGroup value={conferenceRadioValue} onChange={handleConferenceSourceChange}>
          <FormControlLabel value="core" control={<Radio size="small" />} label={<Typography variant="body2">CORE (default)</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 1.5 }}>
            Conferences and workshops ranked by{' '}
            <Link href="http://portal.core.edu.au/conf-ranks/" target="_blank" rel="noreferrer">CORE</Link> (A*, A, B, C) —
            each publication matched against whichever edition was current the year it came out.
            Latest available: CORE {editions?.core ?? '…'}.
          </Typography>
          <FormControlLabel value="ccf" control={<Radio size="small" />} label={<Typography variant="body2">CCF</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 1.5 }}>
            Ranked instead on the{' '}
            <Link href="https://www.ccf.org.cn/Academic_Evaluation/By_category/" target="_blank" rel="noreferrer">CCF</Link>{' '}
            A/B/C scale, matched against the edition current when each paper was published.
            Latest available: {editions?.ccf ?? '…'}.
          </Typography>
          <FormControlLabel value={CUSTOM_RADIO_VALUE} control={<Radio size="small" />} label={<Typography variant="body2">Custom</Typography>} />
          {conferenceRadioValue === CUSTOM_RADIO_VALUE && (
            <CustomAxisSection
              source={conferenceSource}
              onSourceChange={handleConferenceCustomResolved}
              profiles={conferenceProfiles}
              creationReferences={['core', 'ccf']}
            />
          )}
        </RadioGroup>
        <Divider sx={{ mt: 2, mb: 2.5 }} />

        <Typography variant="subtitle1" gutterBottom>Journal ranking</Typography>
        <RadioGroup value={journalRadioValue} onChange={handleJournalSourceChange}>
          <FormControlLabel value="sjr" control={<Radio size="small" />} label={<Typography variant="body2">SJR (default)</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 1.5 }}>
            Journals ranked by{' '}
            <Link href="https://www.scimagojr.com/" target="_blank" rel="noreferrer">SJR / Scimago</Link> (Q1–Q4) —
            each publication matched against whichever edition was current the year it came out.
            Latest available: SJR {editions?.sjr ?? '…'}.
          </Typography>
          <FormControlLabel value="ccf" control={<Radio size="small" />} label={<Typography variant="body2">CCF</Typography>} />
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5, mb: 1.5 }}>
            Ranked instead on the{' '}
            <Link href="https://www.ccf.org.cn/Academic_Evaluation/By_category/" target="_blank" rel="noreferrer">CCF</Link>{' '}
            A/B/C scale, matched against the edition current when each paper was published.
            Latest available: {editions?.ccf ?? '…'}.
          </Typography>
          <FormControlLabel value={CUSTOM_RADIO_VALUE} control={<Radio size="small" />} label={<Typography variant="body2">Custom</Typography>} />
          {journalRadioValue === CUSTOM_RADIO_VALUE && (
            <CustomAxisSection
              source={journalSource}
              onSourceChange={handleJournalCustomResolved}
              profiles={journalProfiles}
              creationReferences={['sjr', 'ccf']}
            />
          )}
        </RadioGroup>
        <Divider sx={{ mt: 2, mb: 2.5 }} />

        <Typography variant="subtitle1" gutterBottom>Custom rankings</Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1 }}>
          Define your own ranking by starting from CORE, SJR, or CCF and overriding specific venues by hand.
        </Typography>
        <Button size="small" startIcon={<EditIcon />} onClick={onManageCustomRankings}>
          Manage custom rankings…
        </Button>
        <Divider sx={{ mt: 2, mb: 2.5 }} />

        <Typography variant="subtitle1" gutterBottom>Match corrections</Typography>
        <FormControlLabel
          control={<Checkbox checked={useCommunityOverrides} onChange={handleCommunityOverridesChange} size="small" />}
          label={<Typography variant="body2">Use community-confirmed corrections</Typography>}
        />
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', ml: 4, mt: -0.5 }}>
          When a match gets corrected the same way by several different people, everyone sees that correction
          by default. Your own corrections (see &quot;My match corrections&quot;) always take priority over this.
        </Typography>
        <Divider sx={{ my: 2 }} />
        <Typography variant="subtitle1" gutterBottom>Personal identity links and cross-check decisions</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
          Manage all choices saved in this browser. To share only one author or structure, use the controls on its page.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <IdentityLinksButton all />
          <CrosscheckDecisionsButton />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

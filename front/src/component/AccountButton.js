import { useEffect, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, TextField, Typography } from '@mui/material';
import { getCurrentUser, loginWithCode, registerAccount, startAccountSync, syncNow, updateLabel } from '../accountSync';

export function AccountButton() {
  const [signedIn, setSignedIn] = useState(false);
  const [available, setAvailable] = useState(false);
  const [label, setLabel] = useState(null);
  const [labelInput, setLabelInput] = useState('');
  const [newAccountLabel, setNewAccountLabel] = useState('');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState(null);
  const [codeInput, setCodeInput] = useState('');
  const [error, setError] = useState('');

  const refresh = () => getCurrentUser().then(result => {
    setSignedIn(result.signedIn); setAvailable(result.available); setLabel(result.label || null);
    setLabelInput(result.label || '');
  }).catch(() => {});

  useEffect(() => {
    let active = true;
    getCurrentUser().then(async result => {
      if (!active) return;
      setSignedIn(result.signedIn); setAvailable(result.available); setLabel(result.label || null);
      setLabelInput(result.label || '');
      if (result.signedIn) await syncNow().catch(() => {});
    }).catch(() => {});
    const onAccount = () => { if (active) refresh(); };
    window.addEventListener('rankme:accountchange', onAccount);
    const stop = startAccountSync();
    return () => { active = false; window.removeEventListener('rankme:accountchange', onAccount); stop(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openDialog = () => { setOpen(true); setNewCode(null); setCodeInput(''); setNewAccountLabel(''); setError(''); };
  const closeDialog = () => { setOpen(false); setNewCode(null); setCodeInput(''); setError(''); };

  const register = async () => {
    setBusy(true); setError('');
    try {
      const result = await registerAccount(newAccountLabel.trim() || undefined);
      setNewCode(result.code);
      setLabel(result.label || null);
      setLabelInput(result.label || '');
      window.dispatchEvent(new Event('rankme:accountchange'));
      await syncNow().catch(() => {});
    } catch { setError('Could not create a sync account.'); }
    finally { setBusy(false); }
  };

  const signIn = async () => {
    setBusy(true); setError('');
    try {
      const ok = await loginWithCode(codeInput);
      if (!ok) { setError('Unknown sync code.'); return; }
      window.dispatchEvent(new Event('rankme:accountchange'));
      await syncNow().catch(() => {});
      closeDialog();
    } catch { setError('Sign-in failed.'); }
    finally { setBusy(false); }
  };

  const signOut = async () => {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
    setSignedIn(false); setLabel(null); closeDialog();
    window.dispatchEvent(new Event('rankme:accountchange'));
  };

  const synchronize = async () => {
    setBusy(true);
    try { await syncNow(); } finally { setBusy(false); }
  };

  const saveLabel = async () => {
    setBusy(true); setError('');
    try { setLabel(await updateLabel(labelInput.trim())); }
    catch { setError('Could not update the account name.'); }
    finally { setBusy(false); }
  };

  if (!available) return null;
  return <>
    <Button color="inherit" size="small" onClick={openDialog} sx={{ textTransform: 'none', ml: 1 }}>
      {signedIn ? (label || 'Synced') : 'Sync'}
    </Button>
    <Dialog open={open} onClose={closeDialog} maxWidth="xs" fullWidth>
      <DialogTitle>Account synchronization</DialogTitle>
      <DialogContent>
        {newCode ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Alert severity="warning">Save this code now — it is shown only once and there is no way to recover it if lost.</Alert>
            <TextField value={newCode} inputProps={{ readOnly: true }} fullWidth />
            <Button onClick={() => navigator.clipboard?.writeText(newCode)}>Copy code</Button>
            <Typography variant="body2" color="text.secondary">Accounts with no activity for 30 days are automatically deleted.</Typography>
          </Stack>
        ) : signedIn ? (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">Your RankMe preferences, teams and personal corrections are synchronized via an anonymous code. No email, username or third-party identity is ever collected.</Typography>
            <Typography variant="body2" color="text.secondary">Accounts with no activity for 30 days are automatically deleted — sign in from time to time to keep this one alive.</Typography>
            <TextField label="Account name (optional)" placeholder="e.g. work laptop" value={labelInput} onChange={e => setLabelInput(e.target.value)} fullWidth />
            <Button onClick={saveLabel} disabled={busy || labelInput.trim() === (label || '')}>Save name</Button>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        ) : (
          <Stack spacing={2} sx={{ mt: 1 }}>
            <Typography variant="body2">Create an anonymous sync account (a random code, no email or username) to synchronize your preferences across devices, or sign in with an existing code.</Typography>
            <Typography variant="body2" color="text.secondary">Accounts with no activity for 30 days are automatically deleted.</Typography>
            <TextField label="Account name (optional)" placeholder="e.g. work laptop" value={newAccountLabel} onChange={e => setNewAccountLabel(e.target.value)} fullWidth />
            <Button variant="contained" onClick={register} disabled={busy}>Create a sync account</Button>
            <Typography variant="body2" sx={{ mt: 1 }}>Or sign in with an existing code:</Typography>
            <TextField label="Sync code" value={codeInput} onChange={e => setCodeInput(e.target.value)} fullWidth />
            <Button onClick={signIn} disabled={busy || !codeInput.trim()}>Sign in</Button>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {signedIn && !newCode && <Button onClick={synchronize} disabled={busy}>{busy ? 'Synchronizing…' : 'Synchronize now'}</Button>}
        {signedIn && !newCode && <Button onClick={signOut} color="error">Sign out</Button>}
        <Button onClick={closeDialog}>Close</Button>
      </DialogActions>
    </Dialog>
  </>;
}

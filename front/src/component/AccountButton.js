import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Dialog, DialogActions, DialogContent, DialogTitle, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { Visibility, VisibilityOff } from '@mui/icons-material';
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
  const [showNewCode, setShowNewCode] = useState(true);
  const [showCodeInput, setShowCodeInput] = useState(false);
  const [error, setError] = useState('');
  const newCodeInputRef = useRef(null);

  useEffect(() => {
    // React sets the controlled value directly on the DOM node, without firing a
    // real 'input' event — password managers (1Password, etc.) only pick up a
    // password-type field's content from that event, so they never notice this
    // generated code unless we dispatch one ourselves.
    if (!newCode || !newCodeInputRef.current) return;
    const input = newCodeInputRef.current;
    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    nativeSetter.call(input, newCode);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }, [newCode]);

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

  const openDialog = () => { setOpen(true); setNewCode(null); setCodeInput(''); setNewAccountLabel(''); setShowCodeInput(false); setError(''); };
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
          <form onSubmit={e => { e.preventDefault(); closeDialog(); }}>
            <Stack spacing={2} sx={{ mt: 1 }}>
              <Alert severity="warning">Save this code now — it is shown only once and there is no way to recover it if lost.</Alert>
              <TextField
                value={newCode}
                inputRef={newCodeInputRef}
                inputProps={{ readOnly: true }}
                type={showNewCode ? 'text' : 'password'}
                name="sync-code"
                id="sync-code-new"
                autoComplete="new-password"
                fullWidth
                InputProps={{
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton onClick={() => setShowNewCode(v => !v)} edge="end" size="small">
                        {showNewCode ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                      </IconButton>
                    </InputAdornment>
                  )
                }}
              />
              <Button onClick={() => navigator.clipboard?.writeText(newCode)}>Copy code</Button>
              <Typography variant="body2" color="text.secondary">Accounts with no activity for 30 days are automatically deleted.</Typography>
              <Button type="submit" variant="contained">Done</Button>
            </Stack>
          </form>
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
            <form onSubmit={e => { e.preventDefault(); register(); }}>
              <Stack spacing={2}>
                <TextField label="Account name (optional)" placeholder="e.g. work laptop" value={newAccountLabel} onChange={e => setNewAccountLabel(e.target.value)} autoComplete="username" fullWidth />
                <Button type="submit" variant="contained" disabled={busy}>Create a sync account</Button>
              </Stack>
            </form>
            <Typography variant="body2" sx={{ mt: 1 }}>Or sign in with an existing code:</Typography>
            <form onSubmit={e => { e.preventDefault(); signIn(); }}>
              <Stack spacing={2}>
                <TextField
                  label="Sync code"
                  value={codeInput}
                  onChange={e => setCodeInput(e.target.value)}
                  type={showCodeInput ? 'text' : 'password'}
                  name="sync-code"
                  id="sync-code-login"
                  autoComplete="current-password"
                  fullWidth
                  InputProps={{
                    endAdornment: (
                      <InputAdornment position="end">
                        <IconButton onClick={() => setShowCodeInput(v => !v)} edge="end" size="small">
                          {showCodeInput ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                        </IconButton>
                      </InputAdornment>
                    )
                  }}
                />
                <Button type="submit" disabled={busy || !codeInput.trim()}>Sign in</Button>
              </Stack>
            </form>
            {error && <Alert severity="error">{error}</Alert>}
          </Stack>
        )}
      </DialogContent>
      <DialogActions>
        {signedIn && !newCode && <Button onClick={synchronize} disabled={busy}>{busy ? 'Synchronizing…' : 'Synchronize now'}</Button>}
        {signedIn && !newCode && <Button onClick={signOut} color="error">Sign out</Button>}
        {!newCode && <Button onClick={closeDialog}>Close</Button>}
      </DialogActions>
    </Dialog>
  </>;
}

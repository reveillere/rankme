import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';

const TOKEN_KEY = 'rankme:adminToken';
const POLL_MS = 5000;

function formatBytes(bytes) {
  if (!bytes && bytes !== 0) return '—';
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(1)} MB`;
}

function formatDuration(seconds) {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h}h ${m}m ${s}s`;
}

// Lightweight in-app admin dashboard: no Prometheus/Grafana/Loki here on
// purpose (see api/src/metrics.js) — this polls a single JSON endpoint the
// API already computes in memory.
export default function AdminDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [tokenInput, setTokenInput] = useState('');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const previousTitle = document.title;
    document.title = 'rankme — admin';
    return () => { document.title = previousTitle; };
  }, []);

  const fetchStats = useCallback(async (currentToken) => {
    try {
      const resp = await fetch('/api/admin/stats', { headers: { 'X-Admin-Token': currentToken } });
      if (resp.status === 401) {
        setError('Invalid token.');
        setToken('');
        localStorage.removeItem(TOKEN_KEY);
        return;
      }
      if (!resp.ok) {
        setError(`Request failed (${resp.status}).`);
        return;
      }
      setStats(await resp.json());
      setError(null);
    } catch (err) {
      setError(`Request failed: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    if (!token) return;
    fetchStats(token);
    const interval = setInterval(() => fetchStats(token), POLL_MS);
    return () => clearInterval(interval);
  }, [token, fetchStats]);

  const connect = () => {
    if (!tokenInput) return;
    localStorage.setItem(TOKEN_KEY, tokenInput);
    setToken(tokenInput);
  };

  if (!token) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', mt: '15vh' }}>
        <Card sx={{ width: 360 }}>
          <CardContent>
            <Typography variant="h6" gutterBottom>Admin dashboard</Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Enter the ADMIN_TOKEN (see the API container logs if none was configured).
            </Typography>
            {error && <Alert severity="error" sx={{ my: 1 }}>{error}</Alert>}
            <TextField
              label="Token"
              type="password"
              value={tokenInput}
              onChange={e => setTokenInput(e.target.value)}
              fullWidth
              size="small"
              sx={{ my: 2 }}
              onKeyDown={e => e.key === 'Enter' && connect()}
            />
            <Button variant="contained" fullWidth disabled={!tokenInput} onClick={connect}>
              Connect
            </Button>
          </CardContent>
        </Card>
      </Box>
    );
  }

  if (!stats) {
    return <Box sx={{ p: 4, textAlign: 'center' }}>{error ? <Alert severity="error">{error}</Alert> : 'Loading…'}</Box>;
  }

  const { process, metrics, throttler, mongo, redis } = stats;

  return (
    <Box sx={{ p: 4, maxWidth: 1100, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>rankme — admin</Typography>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2, mb: 3 }}>
        <StatCard title="API process">
          <Line label="Uptime" value={formatDuration(process.uptimeSeconds)} />
          <Line label="RSS" value={formatBytes(process.memory.rss)} />
          <Line label="Heap used" value={formatBytes(process.memory.heapUsed)} />
        </StatCard>

        <StatCard title="Traffic">
          <Line label="Total requests" value={metrics.totalRequests} />
          <Line label="Errors" value={metrics.totalErrors} />
          <Line label="Error rate" value={`${(metrics.errorRate * 100).toFixed(1)}%`} highlight={metrics.errorRate > 0.05} />
        </StatCard>

        <StatCard title="Mongo">
          <Line label="Status" value={<StatusChip ok={mongo.ok} />} />
          <Line label="Venues cached" value={mongo.venuesCount ?? '—'} />
        </StatCard>

        <StatCard title="Redis">
          <Line label="Status" value={<StatusChip ok={redis.ok} />} />
          <Line label="Keys" value={redis.dbsize ?? '—'} />
          <Line label="Memory" value={redis.usedMemory ?? '—'} />
        </StatCard>

        <StatCard title="DBLP throttler">
          <Line label="Author/search queue" value={`${throttler.limiters.dblp.QUEUED} queued, ${throttler.limiters.dblp.RUNNING} running`} />
          <Line label="Venue-scrape queue" value={`${throttler.limiters.dblpScrape.QUEUED} queued, ${throttler.limiters.dblpScrape.RUNNING} running`} />
          <Line
            label="Scrape circuit breaker"
            value={throttler.scrape.coolingDown ? `Cooling down (${throttler.scrape.failureStreak} failures)` : 'Closed'}
            highlight={throttler.scrape.coolingDown}
          />
        </StatCard>
      </Box>

      <Typography variant="h6" gutterBottom>Requests by route</Typography>
      <Card sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Route</TableCell>
              <TableCell align="right">Count</TableCell>
              <TableCell align="right">p50</TableCell>
              <TableCell align="right">p95</TableCell>
              <TableCell align="right">p99</TableCell>
              <TableCell>Status codes</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {metrics.routes.map(r => (
              <TableRow key={r.route}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{r.route}</TableCell>
                <TableCell align="right">{r.count}</TableCell>
                <TableCell align="right">{r.p50}ms</TableCell>
                <TableCell align="right">{r.p95}ms</TableCell>
                <TableCell align="right">{r.p99}ms</TableCell>
                <TableCell>
                  {Object.entries(r.statusCounts).map(([code, n]) => (
                    <Chip key={code} size="small" sx={{ mr: 0.5 }} label={`${code}: ${n}`} color={Number(code) >= 400 ? 'error' : 'default'} />
                  ))}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Typography variant="h6" gutterBottom>Recent errors</Typography>
      <Card>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Time</TableCell>
              <TableCell>Method</TableCell>
              <TableCell>Path</TableCell>
              <TableCell align="right">Status</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {metrics.recentErrors.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center">No recent errors</TableCell></TableRow>
            )}
            {metrics.recentErrors.map((e, i) => (
              <TableRow key={i}>
                <TableCell>{new Date(e.time).toLocaleTimeString()}</TableCell>
                <TableCell>{e.method}</TableCell>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{e.path}</TableCell>
                <TableCell align="right">{e.status}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </Box>
  );
}

function StatCard({ title, children }) {
  return (
    <Card>
      <CardContent>
        <Typography variant="subtitle2" color="text.secondary" gutterBottom>{title}</Typography>
        {children}
      </CardContent>
    </Card>
  );
}

function Line({ label, value, highlight }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.25 }}>
      <Typography variant="body2" color="text.secondary">{label}</Typography>
      <Typography variant="body2" component="span" sx={{ fontWeight: 600, color: highlight ? 'error.main' : 'text.primary' }}>{value}</Typography>
    </Box>
  );
}

function StatusChip({ ok }) {
  return <Chip size="small" label={ok ? 'OK' : 'DOWN'} color={ok ? 'success' : 'error'} />;
}

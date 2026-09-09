import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import { Line } from 'react-chartjs-2';
import {
  Chart,
  LineElement,
  PointElement,
  LinearScale,
  CategoryScale,
  Tooltip as ChartTooltip,
  Legend,
  Filler,
} from 'chart.js';

Chart.register(LineElement, PointElement, LinearScale, CategoryScale, ChartTooltip, Legend, Filler);

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

function formatElapsed(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
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

  const { process, metrics, throttler, ranking, mongo, redis, dblp } = stats;
  const activeStreams = ranking.activeStreams;

  const chartData = {
    labels: metrics.history.map(h => new Date(h.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })),
    datasets: [
      {
        label: 'Requests/min',
        data: metrics.history.map(h => h.count),
        borderColor: '#196ca3',
        backgroundColor: 'rgba(25, 108, 163, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      {
        label: 'Distinct clients/min',
        data: metrics.history.map(h => h.distinctClients),
        borderColor: '#c32b72',
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      y: { beginAtZero: true, ticks: { precision: 0 } },
      x: { ticks: { maxTicksLimit: 12 } },
    },
    plugins: {
      legend: { position: 'top', align: 'end', labels: { boxWidth: 12 } },
    },
  };

  return (
    <Box sx={{ p: 4, maxWidth: 1100, margin: '0 auto' }}>
      <Typography variant="h4" gutterBottom>rankme — admin</Typography>
      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 3 }}>
        <SummaryTile label="Uptime" value={formatDuration(process.uptimeSeconds)} />
        <SummaryTile label="Requests" value={metrics.totalRequests} />
        <SummaryTile label="Error rate" value={`${(metrics.errorRate * 100).toFixed(1)}%`} highlight={metrics.errorRate > 0.05} />
        <SummaryTile label="Distinct clients" value={metrics.totalDistinctClients} />
        <SummaryTile label="Rankings in progress" value={activeStreams.length} highlight={activeStreams.length > 0} />
      </Box>

      <Typography variant="h6" gutterBottom>Traffic — last hour</Typography>
      <Card sx={{ mb: 3, p: 2 }}>
        <Box sx={{ height: 220 }}>
          <Line data={chartData} options={chartOptions} />
        </Box>
      </Card>

      <Typography variant="h6" gutterBottom>Rankings in progress ({activeStreams.length})</Typography>
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ pb: 1 }}>
          <Line2 label="Ranking queue" value={`${ranking.queue.QUEUED} queued, ${ranking.queue.RUNNING} running`} />
        </CardContent>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Author / team</TableCell>
              <TableCell>Progress</TableCell>
              <TableCell align="right">Elapsed</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {activeStreams.length === 0 && (
              <TableRow><TableCell colSpan={3} align="center">No ranking request in progress</TableCell></TableRow>
            )}
            {activeStreams.map((s, i) => (
              <TableRow key={i}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{s.label}</TableCell>
                <TableCell sx={{ width: '40%' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={s.total ? (s.completed / s.total) * 100 : 0}
                      sx={{ flexGrow: 1, borderRadius: 4, height: 6 }}
                    />
                    <Typography variant="caption" color="text.secondary">{s.completed}/{s.total}</Typography>
                  </Box>
                </TableCell>
                <TableCell align="right">{formatElapsed(s.elapsedMs)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 2, mb: 3 }}>
        <StatCard title="API process">
          <Line2 label="RSS" value={formatBytes(process.memory.rss)} />
          <Line2 label="Heap used" value={formatBytes(process.memory.heapUsed)} />
        </StatCard>

        <StatCard title="Mongo">
          <Line2 label="Status" value={<StatusChip ok={mongo.ok} />} />
          <Line2 label="Venues cached" value={mongo.venuesCount ?? '—'} />
        </StatCard>

        <StatCard title="Redis">
          <Line2 label="Status" value={<StatusChip ok={redis.ok} />} />
          <Line2 label="Keys" value={redis.dbsize ?? '—'} />
          <Line2 label="Memory" value={redis.usedMemory ?? '—'} />
        </StatCard>

        <StatCard title="DBLP throttler">
          {/* Dormant in practice: author/search/venue lookups are served
              from the local dump now (see the "DBLP local dump" card) --
              this only fires again if that dump is ever unavailable and
              the live dblp.org fallback code paths get reconnected. */}
          <Line2 label="Author/search queue" value={`${throttler.limiters.dblp.QUEUED} queued, ${throttler.limiters.dblp.RUNNING} running`} />
          <Line2 label="Venue-scrape queue" value={`${throttler.limiters.dblpScrape.QUEUED} queued, ${throttler.limiters.dblpScrape.RUNNING} running`} />
          <Line2
            label="Scrape circuit breaker"
            value={throttler.scrape.coolingDown ? `Cooling down (${throttler.scrape.failureStreak} failures)` : 'Closed'}
            highlight={throttler.scrape.coolingDown}
          />
        </StatCard>

        <StatCard title="DBLP local dump">
          <Line2
            label="Status"
            value={dblp?.importing ? 'Importing…' : <StatusChip ok={!!dblp?.ready} />}
            highlight={dblp?.importing}
          />
          <Line2 label="Imported" value={dblp?.importedAt ? new Date(dblp.importedAt).toLocaleString('en-US') : '—'} />
          <Line2 label="Dump MD5" value={dblp?.version ? dblp.version.slice(0, 12) + '…' : '—'} />
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

function SummaryTile({ label, value, highlight }) {
  return (
    <Card>
      <CardContent sx={{ textAlign: 'center', py: 2, '&:last-child': { pb: 2 } }}>
        <Typography variant="h5" sx={{ fontWeight: 700, color: highlight ? 'error.main' : 'text.primary' }}>
          {value}
        </Typography>
        <Typography variant="caption" color="text.secondary">{label}</Typography>
      </CardContent>
    </Card>
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

function Line2({ label, value, highlight }) {
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

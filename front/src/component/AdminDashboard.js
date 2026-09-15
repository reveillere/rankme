import { useEffect, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import LinearProgress from '@mui/material/LinearProgress';
import ToggleButtonGroup from '@mui/material/ToggleButtonGroup';
import ToggleButton from '@mui/material/ToggleButton';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import Alert from '@mui/material/Alert';
import Link from '@mui/material/Link';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
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

// Shared by the Traffic and Outbound requests sections below -- both offer
// the same four ranges over the same two data shapes the API exposes
// (metrics.js's/throttler.js's minute-or-hourly rollups): a fixed-length
// recent window (1h, at whatever resolution that section's own "recent"
// array already has) and 24h/30d windows filtered out of an hourly
// rollup, or "full" for the lifetime total the backend never prunes.
const RANGE_MS = { '1h': 60 * 60 * 1000, '24h': 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 };

function inWindow(bucket, rangeMs) {
  return bucket.time >= Date.now() - rangeMs;
}

function RangeSelector({ value, onChange }) {
  return (
    <ToggleButtonGroup size="small" value={value} exclusive onChange={(e, v) => v && onChange(v)}>
      <ToggleButton value="1h">1h</ToggleButton>
      <ToggleButton value="24h">24h</ToggleButton>
      <ToggleButton value="30d">30d</ToggleButton>
      <ToggleButton value="full">Full</ToggleButton>
    </ToggleButtonGroup>
  );
}

// Lightweight in-app admin dashboard: no Prometheus/Grafana/Loki here on
// purpose (see api/src/metrics.js) — this polls a single JSON endpoint the
// API already computes in memory.
export default function AdminDashboard() {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_KEY) || '');
  const [tokenInput, setTokenInput] = useState('');
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [trafficRange, setTrafficRange] = useState('1h');
  const [outboundRange, setOutboundRange] = useState('24h');

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

  const { process, metrics, ranking, mongo, redis, dblp, throttler, containers } = stats;
  const activeStreams = ranking.activeStreams;

  // The 1h view uses metrics.history (minute-resolution, exactly today's
  // previous default) with its own per-minute distinct-clients line; 24h/30d/
  // full use metrics.hourlyHistory (hourly-resolution, no per-bucket distinct
  // clients -- see metrics.js's own comment on why) filtered to the range,
  // or left as-is for "full" (already bounded to ~31 days server-side).
  const trafficSeries = trafficRange === '1h'
    ? metrics.history
    : metrics.hourlyHistory.filter(h => trafficRange === 'full' || inWindow(h, RANGE_MS[trafficRange]));
  const trafficLabelFormat = trafficRange === '1h'
    ? (t) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : (t) => new Date(t).toLocaleString([], { month: 'numeric', day: 'numeric', hour: '2-digit' });

  // Requests/error rate tiles follow the same range as the chart, except
  // "full": that's metrics' own never-pruned totals directly (exact),
  // rather than summing hourlyHistory which only covers ~31 days.
  const trafficTotals = trafficRange === 'full'
    ? { requests: metrics.totalRequests, errors: metrics.totalErrors }
    : trafficSeries.reduce((acc, h) => ({ requests: acc.requests + h.count, errors: acc.errors + h.errors }), { requests: 0, errors: 0 });

  const chartData = {
    labels: trafficSeries.map(h => trafficLabelFormat(h.time)),
    datasets: [
      {
        label: trafficRange === '1h' ? 'Requests/min' : 'Requests/hour',
        data: trafficSeries.map(h => h.count),
        borderColor: '#196ca3',
        backgroundColor: 'rgba(25, 108, 163, 0.15)',
        fill: true,
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      },
      ...(trafficRange === '1h' ? [{
        label: 'Distinct clients/min',
        data: trafficSeries.map(h => h.distinctClients),
        borderColor: '#c32b72',
        backgroundColor: 'transparent',
        borderDash: [4, 3],
        tension: 0.3,
        pointRadius: 0,
        yAxisID: 'y',
      }] : []),
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

      {/* External dashboards this in-app page doesn't try to replace: this
          page's own "last hour" chart below is a quick live glance, not a
          substitute for Grafana's real history/retention (infra metrics --
          request rates, host CPU/memory) or Umami's visitor analytics
          (traffic, referrers, page views over any range). Both are their
          own separate optional stacks (see monitoring/ and analytics/) and
          need their own login. */}
      <Box sx={{ display: 'flex', gap: 3, mb: 2 }}>
        {/* Deep-linked straight to the one dashboard/view actually used
            day-to-day, not Grafana's/Umami's own generic landing page --
            still needs their own login, this just skips the extra click
            once through it. */}
        <Link href="/grafana/d/rankme-overview/rankme-overview" target="_blank" rel="noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          Grafana <OpenInNewIcon sx={{ fontSize: '0.9em' }} />
        </Link>
        <Link href="/analytics/websites/c5bfde95-4037-450b-82a1-09f2d9b6e235" target="_blank" rel="noreferrer" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          Analytics (Umami) <OpenInNewIcon sx={{ fontSize: '0.9em' }} />
        </Link>
      </Box>

      {error && <Alert severity="warning" sx={{ mb: 2 }}>{error}</Alert>}

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 2, mb: 3 }}>
        <SummaryTile label="Uptime" value={formatDuration(process.uptimeSeconds)} />
        <SummaryTile label={`Requests (${trafficRange})`} value={trafficTotals.requests} />
        <SummaryTile
          label={`Error rate (${trafficRange})`}
          value={`${trafficTotals.requests ? ((trafficTotals.errors / trafficTotals.requests) * 100).toFixed(1) : '0.0'}%`}
          highlight={trafficTotals.requests > 0 && trafficTotals.errors / trafficTotals.requests > 0.05}
        />
        <SummaryTile label="Distinct clients (all-time)" value={metrics.totalDistinctClients} />
        <SummaryTile label="Rankings in progress" value={activeStreams.length} highlight={activeStreams.length > 0} />
      </Box>

      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Traffic</Typography>
        <RangeSelector value={trafficRange} onChange={setTrafficRange} />
      </Box>
      <Card sx={{ mb: 3, p: 2 }}>
        <Box sx={{ height: 220 }}>
          {trafficSeries.length === 0
            ? <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', pt: 8 }}>No data yet for this range</Typography>
            : <Line data={chartData} options={chartOptions} />}
        </Box>
      </Card>

      <Typography variant="h6" gutterBottom>Rankings in progress ({activeStreams.length})</Typography>
      <Card sx={{ mb: 3 }}>
        <CardContent sx={{ pb: 1 }}>
          <Line2 label="Ranking queue" value={`${ranking.queue.queued} queued, ${ranking.queue.running} running`} />
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
        <StatCard title="Mongo">
          <Line2 label="Status" value={<StatusChip ok={mongo.ok} />} />
          <Line2 label="Venues cached" value={mongo.venuesCount ?? '—'} />
        </StatCard>

        <StatCard title="Redis">
          <Line2 label="Status" value={<StatusChip ok={redis.ok} />} />
          <Line2 label="Keys" value={redis.dbsize ?? '—'} />
          <Line2 label="Memory" value={redis.usedMemory ?? '—'} />
          {/* Cumulative since redis's own last restart (see cache.js's
              status()), not this process's/this window's -- a lifetime
              ratio, same spirit as Mongo's/DBLP's own status fields above. */}
          <Line2 label="Hit rate" value={redis.hitRate != null ? `${(redis.hitRate * 100).toFixed(1)}%` : '—'} />
          <Line2 label="Hits / misses" value={`${redis.keyspaceHits ?? 0} / ${redis.keyspaceMisses ?? 0}`} />
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

      {/* Sourced from Prometheus/cAdvisor (see admin.js's getContainerMemory)
          -- null when the monitoring/ stack isn't deployed, not an error,
          same as dblp's own "not imported yet" states above. Replaces the
          old standalone "API process" card: that showed process.memoryUsage()
          (this Node process's own RSS/heap) with no limit to compare it
          against, which is exactly what made it hard to read at a glance --
          the api container's own row here carries the same cgroup-level
          number every other container's row does, against its own
          docker-compose memory limit. */}
      <Typography variant="h6" gutterBottom>Containers — memory</Typography>
      <Card sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Container</TableCell>
              <TableCell align="right">Used</TableCell>
              <TableCell align="right">Limit</TableCell>
              <TableCell sx={{ width: '30%' }}>% of limit</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {containers == null && (
              <TableRow><TableCell colSpan={4} align="center">Not available — the monitoring/ stack (Prometheus + cAdvisor) isn&apos;t deployed</TableCell></TableRow>
            )}
            {containers?.length === 0 && (
              <TableRow><TableCell colSpan={4} align="center">No container metrics yet</TableCell></TableRow>
            )}
            {containers?.map(c => (
              <TableRow key={c.name}>
                <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{c.name}</TableCell>
                <TableCell align="right">{formatBytes(c.usedBytes)}</TableCell>
                <TableCell align="right">{c.limitBytes ? formatBytes(c.limitBytes) : '—'}</TableCell>
                <TableCell>
                  {c.pct != null ? (
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <LinearProgress
                        variant="determinate"
                        value={Math.min(100, c.pct)}
                        color={c.pct > 90 ? 'error' : c.pct > 75 ? 'warning' : 'primary'}
                        sx={{ flexGrow: 1, borderRadius: 4, height: 6 }}
                      />
                      <Typography variant="caption" color={c.pct > 90 ? 'error.main' : 'text.secondary'} sx={{ minWidth: '3.5em' }}>
                        {c.pct.toFixed(1)}%
                      </Typography>
                    </Box>
                  ) : '—'}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Every external call this process makes (DBLP dump, Crossref, CORE,
          CCF, HAL, SJR -- see throttler.js). "Full" is the exact lifetime
          total (never pruned); 1h/24h/30d sum throttler.js's own hourly
          rollup for that host, filtered to the range -- outbound volume is
          low enough (per ranked publication, not per HTTP request) that
          hourly is plenty of resolution even for the "1h" view. */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
        <Typography variant="h6">Outbound requests</Typography>
        <RangeSelector value={outboundRange} onChange={setOutboundRange} />
      </Box>
      <Card sx={{ mb: 3 }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell>Host</TableCell>
              <TableCell align="right">Total</TableCell>
              <TableCell align="right">OK</TableCell>
              <TableCell align="right">Failed</TableCell>
              <TableCell align="right">Rate-limited</TableCell>
              <TableCell align="right">Last call</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {Object.keys(throttler.outbound).length === 0 && (
              <TableRow><TableCell colSpan={6} align="center">No outbound calls yet</TableCell></TableRow>
            )}
            {Object.entries(throttler.outbound).map(([host, { full, hourlyHistory }]) => {
              const s = outboundRange === 'full'
                ? full
                : hourlyHistory.filter(h => inWindow(h, RANGE_MS[outboundRange]))
                    .reduce((acc, h) => ({ total: acc.total + h.total, ok: acc.ok + h.ok, failed: acc.failed + h.failed, rateLimited: acc.rateLimited + h.rateLimited }),
                      { total: 0, ok: 0, failed: 0, rateLimited: 0 });
              return (
                <TableRow key={host}>
                  <TableCell sx={{ fontFamily: 'monospace', fontSize: '0.8em' }}>{host}</TableCell>
                  <TableCell align="right">{s.total}</TableCell>
                  <TableCell align="right">{s.ok}</TableCell>
                  <TableCell align="right" sx={{ color: s.failed > 0 ? 'error.main' : undefined, fontWeight: s.failed > 0 ? 600 : undefined }}>{s.failed}</TableCell>
                  <TableCell align="right">{s.rateLimited}</TableCell>
                  <TableCell align="right">{full.lastCalledAt ? new Date(full.lastCalledAt).toLocaleTimeString() : '—'}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>

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

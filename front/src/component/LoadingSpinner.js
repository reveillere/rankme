import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import LinearProgress from '@mui/material/LinearProgress';

// message: short status line under the spinner (e.g. what's being fetched).
// progress: optional { completed, total } — when total > 0, shows a
// determinate bar + count instead of a bare spinner, so a long author-stream
// wait isn't a black box.
export function LoadingSpinner({ message = 'Loading…', progress }) {
  const hasProgress = progress && progress.total > 0;
  const percent = hasProgress ? Math.floor((progress.completed / progress.total) * 100) : 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 2,
        minHeight: '60vh',
        color: 'text.secondary',
      }}
    >
      {hasProgress ? (
        <CircularProgress color="primary" variant="determinate" value={percent} size={56} thickness={4} />
      ) : (
        <CircularProgress color="primary" size={56} thickness={4} />
      )}

      <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
        {message}
      </Typography>

      {hasProgress && (
        <Box sx={{ width: 220 }}>
          <LinearProgress variant="determinate" value={percent} sx={{ borderRadius: 4, height: 6 }} />
          <Typography variant="caption" sx={{ display: 'block', textAlign: 'center', mt: 0.5 }}>
            {progress.completed} / {progress.total} publications ranked ({percent}%)
          </Typography>
        </Box>
      )}
    </Box>
  );
}

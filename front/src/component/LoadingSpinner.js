import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { createTheme } from '@mui/material/styles';

const theme = createTheme();

export function LoadingSpinner() {
  return (
    <Box style={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      height: '100vh' // prend toute la hauteur de la fenêtre
    }}>
      <CircularProgress color="primary" />
      <span style={{ color: theme.palette.primary.main }}>
        Loading...
      </span>
    </Box>
  );
}

import { Button } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';
import FilterListOffIcon from '@mui/icons-material/FilterListOff';

export function FilterButton({ isFilterActive, setIsFilterActive }) {
  const handleButtonClick = () => {
    setIsFilterActive(!isFilterActive);
  };

  return (
    <Button
      variant={isFilterActive ? "contained" : "outlined"}
      color="primary"
      size="small"
      startIcon={isFilterActive ? <FilterListOffIcon /> : <FilterListIcon />}
      onClick={handleButtonClick}
      sx={{
        borderRadius: '20px',
        textTransform: 'none',
        fontWeight: 500,
        boxShadow: 'none',
      }}
    >
      {isFilterActive ? 'Filtered' : 'Filter by year'}
    </Button>
  );
}

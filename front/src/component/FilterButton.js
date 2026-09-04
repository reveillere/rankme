import { Button } from '@mui/material';
import FilterListIcon from '@mui/icons-material/FilterList';

export function FilterButton({ isFilterActive, setIsFilterActive }) {
  const handleButtonClick = () => {
    setIsFilterActive(!isFilterActive);
  };

  return (
    <Button
      variant={isFilterActive ? "contained" : "outlined"}
      color="primary"
      endIcon={<FilterListIcon />}
      onClick={handleButtonClick}
    >
      Filter
    </Button>
  );
}

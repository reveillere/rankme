import * as React from 'react';
import ReplayIcon from '@mui/icons-material/Replay'; 
import { IconButton, TextField, Box, Slider } from '@mui/material';
import { useEffect } from 'react';

export default function DateRangeSlider({ minYear, maxYear, range, setRange }) {
    const sliderRef = React.useRef(null);
    // Initialize with marks for every year
    const initialMarks = Array.from({ length: maxYear - minYear + 1 }, (_, index) => ({
        value: minYear + index,
        label: (minYear + index).toString(),
    }));
    const [displayMarks, setDisplayMarks] = React.useState(initialMarks);
    const defaultRange = 4; 
    const [minimalRange, setMinimalRange] = React.useState(defaultRange);


    const calculateMarks = (interval) => {
        const marks = [];
        marks.push({ value: minYear, label: minYear.toString() }); // Always include minYear
    
        for (let year = minYear + interval; year < maxYear; year += interval) {
            marks.push({ value: year, label: year.toString() });
        }
    
        if (marks[marks.length - 1].value !== maxYear) {
            marks.push({ value: maxYear, label: maxYear.toString() }); // Always include maxYear
        }
    
        return marks;
    };

    useEffect(() => {
        if (sliderRef.current) {
            const markElements = sliderRef.current.querySelectorAll('.MuiSlider-markLabel');
            let isOverlapping = false;

            for (let i = 0; i < markElements.length - 1; i++) {
                const currentMark = markElements[i].getBoundingClientRect();
                const nextMark = markElements[i + 1].getBoundingClientRect();

                if (currentMark.right > nextMark.left) {
                    isOverlapping = true;
                    break;
                }
            }

            if (isOverlapping) {
                // If overlapping, adjust the marks to display every 5 years
                const interval = 5;
                setDisplayMarks(calculateMarks(interval));
            } 
        }
    }, []);

    const handleChange = (event, newValue, activeThumb) => {
        if (!Array.isArray(newValue)) {
            return;
        }

        console.log(newValue.toString());
        if (newValue[1] - newValue[0] < minimalRange) {
            if (activeThumb === 0) {
                const clamped = Math.min(newValue[0], maxYear - minimalRange);
                setRange([clamped, clamped + minimalRange]);
            } else {
                const clamped = Math.max(newValue[1], minYear + minimalRange);
                setRange([clamped - minimalRange, clamped]);
            }
        } else {
            setRange(newValue);
        }
    };

    const handleReset = () => {
        setRange([minYear, maxYear]);
    };
    
    const handleInputChange = (event) => {
        const value = Number(event.target.value);
        setMinimalRange(value);
    }

    return (
        <Box sx={{ width: '80%', marginLeft: 10, marginRight: 10 }}>
            <Box sx={{ marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Filter dates from {range[0]} to {range[1]} (range = {minimalRange}): 
                <IconButton
                    color="primary"
                    aria-label="reset"
                    onClick={handleReset}
                    size="small"
                >Reset
                <ReplayIcon fontSize="small"/>
            </IconButton>
            </Box>
            <Slider
                ref={sliderRef}
                getAriaLabel={() => 'Minimum distance shift'}
                value={range}
                min={minYear}
                max={maxYear}
                step={1}
                onChange={handleChange}
                valueLabelDisplay="auto"
                disableSwap
                marks={displayMarks}
            />
            <TextField
                id="standard-basic"
                label="Minimal range"
                defaultValue={minimalRange}
                variant="standard"
                type='number'
                onChange={handleInputChange}
                inputProps={{ min: "1", max: maxYear - minYear }}  
                sx={{ width: '80px', marginTop: '10px' }}  
             />            
        </Box>
    );
}


  
  
  
  
  
  
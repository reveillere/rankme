import * as React from 'react';
import { IconButton, Box, Slider, TextField } from '@mui/material';
import ReplayIcon from '@mui/icons-material/Replay';
import { useEffect } from 'react';

export default function Test() {
    const minYear = 1950;
    const maxYear = 2023;
    const [range, setRange] = React.useState([minYear, maxYear]);

    return (
        <DateRangeSlider minYear={minYear} maxYear={maxYear} range={range} setRange={setRange}  />
    );
}

function DateRangeSlider({ minYear, maxYear, range, setRange }) {
    const sliderRef = React.useRef(null);
    const initialMarks = Array.from({ length: maxYear - minYear + 1 }, (_, index) => ({
        value: minYear + index,
        label: (minYear + index).toString(),
    }));
    const [displayMarks, setDisplayMarks] = React.useState(initialMarks);
    const defaultRange = 4;
    const [minimalRange, setMinimalRange] = React.useState(defaultRange);
    const [disableSwap, setDisableSwap] = React.useState(true);


    const handleChange = (event, newValue, activeThumb) => {
        if (!Array.isArray(newValue)) {
            return;
        }
        if (minimalRange === 0) {
            if (activeThumb === 0) {
                const clamped = Math.min(newValue[0], maxYear);
                setRange([clamped, clamped]);
            } else {
                const clamped = Math.max(newValue[1], minYear);
                setRange([clamped, clamped]);
            }
        } else if (newValue[1] - newValue[0] < minimalRange) {
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

    const handleInputChange = (event) => {
        const previousRange = minimalRange;
        const newRange = Number(event.target.value);
        if (newRange === 0) {
            setRange([range[1], range[1]]);
            setDisableSwap(false);
        } else if (newRange > previousRange) {
            const max = Math.min(range[0] + newRange, maxYear);
            const min = max - newRange;
            setRange([min, max]);
            setDisableSwap(true);
        }
        setMinimalRange(newRange);
    }

    const calculateMarks = (interval) => {
        const marks = [];
        marks.push({ value: minYear, label: minYear.toString() }); 

        for (let year = minYear + interval; year < maxYear; year += interval) {
            marks.push({ value: year, label: year.toString() });
        }

        if (marks[marks.length - 1].value !== maxYear) {
            marks.push({ value: maxYear, label: maxYear.toString() }); 
        }

        return marks;
    };

    const areSliderMarksOverlapping = () => {
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
        return isOverlapping;
    }

    useEffect(() => {
        if (sliderRef.current) {
            let interval = 5  ;
            if (areSliderMarksOverlapping()) {
                // If overlapping, adjust the marks to display every 5 years
                setDisplayMarks(calculateMarks(interval));
            }
        }
    }, []);

    const handleReset = () => {
        setRange([minYear, maxYear]);
    };

    return (
        <Box sx={{ width: 1024, margin: 20 }}>
            <Box sx={{ marginBottom: 2, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                Filter dates from {range[0]} to {range[1]} (range = {minimalRange}):
                <IconButton
                    color="primary"
                    aria-label="reset"
                    onClick={handleReset}
                    size="small"
                >Reset
                    <ReplayIcon fontSize="small" />
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
                disableSwap={disableSwap}
                marks={displayMarks}
            />
            <TextField
                id="standard-basic"
                label="Minimal range"
                defaultValue={minimalRange}
                variant="standard"
                type='number'
                onChange={handleInputChange}
                inputProps={{ min: "0", max: maxYear - minYear }}
                sx={{ width: '80px', marginTop: '10px' }}
            />
        </Box>
    );
}
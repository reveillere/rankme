import * as React from 'react';
import DateRangeSlider from './component/DateRangeSlider';

export default function Test() {
    const minYear = 1980;
    const maxYear = 2022;
    const [range, setRange] = React.useState([minYear, maxYear]);
    return <DateRangeSlider minYear={minYear} maxYear={maxYear} range={range} setRange={setRange} />;
}


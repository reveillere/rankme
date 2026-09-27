export const ranks = {
    'Q1'        : { name: 'Q1',         color: '#c32b72' }, 
    'Q2'        : { name: 'Q2',         color: '#cc9eaf'   }, 
    'Q3'        : { name: 'Q3',         color: '#ff8bbd' }, 
    'Q4'        : { name: 'Q4',         color: '#ffdce8' },
    // Same key CORE's own ranks map uses for its own no-match case --
    // merging the two (see FilterSettingsContext.js's ranksForSource)
    // collapses into a single "Unranked" bucket/row instead of two
    // identical-looking ones that used to coexist under different keys
    // ('Unranked' and 'QU'). Same color as corePortal.js's own 'Unranked'
    // too now (was a different pinkish-gray) -- one merged row should read
    // as one neutral "no grade" color regardless of which axis it came from.
    'Unranked'  : { name: 'Unranked',   color: '#9AA0A6' },
};

export default { ranks };
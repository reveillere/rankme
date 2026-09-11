export const ranks = {
    'Q1'        : { name: 'Q1',         color: '#c32b72' }, 
    'Q2'        : { name: 'Q2',         color: '#cc9eaf'   }, 
    'Q3'        : { name: 'Q3',         color: '#ff8bbd' }, 
    'Q4'        : { name: 'Q4',         color: '#ffdce8' },
    // Same key CORE's own ranks map uses for its own no-match case --
    // merging the two (see FilterSettingsContext.js's ranksForSource)
    // collapses into a single "Unranked" bucket/row instead of two
    // identical-looking ones that used to coexist under different keys
    // ('Unranked' and 'QU').
    'Unranked'  : { name: 'Unranked',   color: '#C0AEB4' },
};

export default { ranks };
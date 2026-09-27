// A*→Misc is one continuous dark-to-light blue gradient (best rank =
// darkest), the same convention sjrPortal.js's own Q1(darkest)→Q4(lightest)
// already uses -- A and B used to share the exact same hex (#72b1d7), which
// wasn't a deliberate step in the scale, just an oversight. Unranked is
// deliberately outside this gradient (it's not a grade at all) and uses the
// same neutral gray sjrPortal.js's own 'Unranked' does, so a conference and
// a journal publication that are both simply unranked read as the same
// "no grade" gray in the stats chart instead of two different tints.
export const ranks = {
    'A*'        : { name: 'A*',         color: '#134d6b' },
    'A'         : { name: 'A',          color: '#41738e' },
    'B'         : { name: 'B',          color: '#6e9ab0' },
    'C'         : { name: 'C',          color: '#9cc0d3' },
    'Misc'      : { name: 'Misc',       color: '#c9e6f5' },
    'Unranked'  : { name: 'Unranked',   color: '#9AA0A6' },
};


export default { ranks };
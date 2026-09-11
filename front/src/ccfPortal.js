// Display-only, mirrors corePortal.js's own front-end sibling -- CCF ranks
// both conferences and journals on one A/B/C scale, no A*/Misc/quartile
// baggage from the merged CORE+SJR taxonomy this app defaults to.
export const ranks = {
    'A'         : { name: 'A',          color: '#134d6b' }, // Bleu Foncé
    'B'         : { name: 'B',          color: '#72b1d7' }, // Bleu Moyen
    'C'         : { name: 'C',          color: '#a5d1eb' }, // Bleu Clair
    'Unranked'  : { name: 'Unranked',   color: '#93A9B6' }, // Gris Clair
};

export default { ranks };

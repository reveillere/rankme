import withCache from './cache';

export const ranks = {
    'A*'        : { name: 'A*',         color: '#134d6b' }, // Bleu Foncé
    'A'         : { name: 'A',          color: '#1f7ca0' }, // Bleu Moyen Foncé
    'B'         : { name: 'B',          color: '#72b1d7' }, // Bleu Moyen Clair
    'C'         : { name: 'C',          color: '#a5d1eb' }, // Bleu Clair
    'Unranked'  : { name: 'Unranked',   color: '#d3d3d3' }, // Gris Clair
    'Misc'      : { name: 'Misc',       color: '#ffd700' }, // Jaune
};


export async function rank(acronym, title, year) {
    const query = `acronym=${encodeURIComponent(acronym)}&title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`;
    const cacheKey = `corePortal:${query}`;
    return await withCache(cacheKey, async () => {
        const resp = await fetch(`/api/core/rank?${query}`);
        const data = await resp.json();
        return data;
    });
}

export default { ranks, rank };
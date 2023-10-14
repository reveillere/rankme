import withCache from './cache';

export const ranks = {
    'Q1'        : { name: 'Q1',          color: '#134d6b' }, // Bleu Foncé
    'Q2'        : { name: 'Q2',          color: '#1f7ca0' }, // Bleu Moyen Foncé
    'Q3'        : { name: 'Q3',          color: '#72b1d7' }, // Bleu Moyen Clair
    'Unranked'  : { name: 'Unranked',    color: '#d3d3d3' }, // Gris Clair
};

export async function rank(title, year) {
    const query = `title=${encodeURIComponent(title)}&year=${encodeURIComponent(year)}`;
    const cacheKey = `sjrPortal:${query}`;
    return await withCache(cacheKey, async () => {
        const resp = await fetch(`/api/sjr/rank?${query}`);
        const data = await resp.json();
        return data;
    });
}

export default { ranks, rank };
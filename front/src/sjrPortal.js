import withCache from './cache';

export const ranks = {
    'Q1'        : { name: 'Q1',          color: '#c32b72' }, 
    'Q2'        : { name: 'Q2',          color: '#ff8bbd' }, 
    'Q3'        : { name: 'Q3',          color: '#ffc6db' }, 
    'QU'        : { name: 'Unranked',    color: '#d3d3d3' }, 
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
import withCache from './cache';

export const ranks = {
    'Q1'        : { name: 'Q1',         color: '#c32b72' }, 
    'Q2'        : { name: 'Q2',         color: '#cc9eaf'   }, 
    'Q3'        : { name: 'Q3',         color: '#ff8bbd' }, 
    'Q4'        : { name: 'Q4',         color: '#ffdce8' },
    'QU'        : { name: 'Unranked',   color: '#C0AEB4' }, 
};

export async function rank(ref, year) {
    const url = `/api/rank/${ref.split('#')[0]}?year=${year}`
    const resp = await fetch(url);
    return await resp.json();
}

export default { ranks, rank };
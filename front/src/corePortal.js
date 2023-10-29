export const ranks = {
    'A*'        : { name: 'A*',         color: '#134d6b' }, // Bleu Foncé
    'A'         : { name: 'A',          color: '#72b1d7' }, // Bleu Moyen Foncé
    'B'         : { name: 'B',          color: '#72b1d7' }, // Bleu Moyen Clair
    'C'         : { name: 'C',          color: '#a5d1eb' }, // Bleu Clair
    'Misc'      : { name: 'Misc',       color: '#D2E876' }, // Jaune
    'Unranked'  : { name: 'Unranked',   color: '#93A9B6' }, // Gris Clair
};


export async function rank(acronym, ref, year) {
    const url = `/api/rank/${ref.split('#')[0]}?acronym=${encodeURIComponent(acronym)}&year=${year}`;
    const resp = await fetch(url);
    return await resp.json();
}

export default { ranks, rank };
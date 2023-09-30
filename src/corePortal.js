import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';


const coreRanksURL = 'http://localhost:3000/core/ranks';


export const ranks = {
    'A*'        : { name: 'A*',         color: '#134d6b' }, // Bleu Foncé
    'A'         : { name: 'A',          color: '#1f7ca0' }, // Bleu Moyen Foncé
    'B'         : { name: 'B',          color: '#72b1d7' }, // Bleu Moyen Clair
    'C'         : { name: 'C',          color: '#a5d1eb' }, // Bleu Clair
    'Unranked'  : { name: 'Unranked',   color: '#d3d3d3' }, // Gris Clair
    'Multi'     : { name: 'Multi',      color: '#ffd700' }, // Jaune
};


export async function load() {
    try {
        const resp = await fetch(coreRanksURL);
        if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
        const json = await resp.json();
        return json;
    } catch (e) {
        console.error('Fetch Error, backup to local file: ');
        try {
            const module = await import('./data/core-ranks.json');
            return module.default || module;
        } catch (e) {
            console.error('Import Error: ', e);
            return []; 
        }
    }   
}




function findSourceForYear(list, year) {
    const sortedList = list.sort((a, b) => b.year - a.year);
    const foundItem = sortedList.find(item => item.year <= year);
    const found = foundItem ? foundItem.source : sortedList[sortedList.length - 1].source;
    return found;
}


async function rank(coreRanks, publication) {
    try {
        const acronym = publication?.dblp?.booktitle;
        if (!acronym) return "Unranked"; 

        const rankingSource = findSourceForYear(coreRanks, publication.dblp.year);

        const ranking = coreRanks.find(rank => rank.source === rankingSource)?.ranks;
        if (!ranking) return "Unranked"; 

        const candidates = ranking.filter(conf => conf.acronym === acronym);
        if (candidates.length === 0) return "Unranked";
        if (candidates.length > 1) return "Multi";

        const entry = candidates[0];
        return ranks[entry.rank] ? entry.rank : "?";
    } catch (error) {
        console.error('Error in rank function:', error);
        return "Error"; 
    }
}


export default {
    load,
    rank,
    ranks,
    findSourceForYear
}
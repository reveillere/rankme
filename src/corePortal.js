import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';
import { getVenueTitle } from './dblp';
import { levenshteinDistance } from './utils';

const coreRanksURL = 'http://localhost:3000/core/ranks';


export const ranks = {
    'A*'        : { name: 'A*',         color: '#134d6b' }, // Bleu Foncé
    'A'         : { name: 'A',          color: '#1f7ca0' }, // Bleu Moyen Foncé
    'B'         : { name: 'B',          color: '#72b1d7' }, // Bleu Moyen Clair
    'C'         : { name: 'C',          color: '#a5d1eb' }, // Bleu Clair
    'Unranked'  : { name: 'Unranked',   color: '#d3d3d3' }, // Gris Clair
    'Misc'      : { name: 'Misc',       color: '#ffd700' }, // Jaune
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

        if (!acronym) {
            return { value: "Unranked", msg: (<div>No acronym</div>) };
        }

        const rankingSource = findSourceForYear(coreRanks, publication.dblp.year);
        const ranking = coreRanks.find(rank => rank.source === rankingSource)?.ranks;
        const candidates = ranking.filter(conf => conf.acronym === acronym);

        if (candidates.length === 0) {
            return { value: "Unranked", msg: (<div>No ranking found in {rankingSource}</div>) };
        }

        if (candidates.length > 1) {
            let fullName = await getVenueTitle(publication);
            let distances = candidates.map(conf => ({ conf: conf, distance: levenshteinDistance(fullName, conf.title) }));
            let bestMatch = distances.reduce((min, current) => current.distance < min.distance ? current : min, distances[0]);
            console.log(`Best match for ${acronym} in ${publication.dblp.year} is ${bestMatch.conf.title} with distance ${bestMatch.distance}`);
            return checkForKnownRank(bestMatch.conf.rank, rankingSource);
        }

        const entry = candidates[0];
        return checkForKnownRank(entry.rank, rankingSource);
    } catch (error) {
        console.error('Error in rank function:', error);
        return "Error"; 
    }
}

function checkForKnownRank(rank, rankingSource) {
    if (ranks[rank]) {
        return { value: rank, msg: (<div>{rankingSource}</div>) };
    } else {
        return { value: "Misc", msg: (<div>Ranked as {rank} in  {rankingSource}</div>) };
    }
}


export default {
    load,
    rank,
    ranks,
    findSourceForYear
}
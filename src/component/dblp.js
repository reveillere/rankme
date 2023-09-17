
import xml2js from 'xml2js';
import { ensureArray } from './utils';


export const dblpCategories = {
    'article'       : { name: 'Journal articles', letter: 'j', color: '#c32b72' },
    'inproceedings' : { name: 'Conference and Workshop Papers', letter: 'c', color: '#196ca3'},
    'proceedings'   : { name: 'Editorship', letter: 'e', color: '#0aeedf' },
    'book'          : { name: 'Books and Theses', letter: 'b', color: '#33c36d' },
    'incollection'  : { name: 'Parts in Books or Collections', letter: 'p', color: '#96ad2c' },
    'informal'      : { name: 'Informal and Other Publications', letter: 'i', color: '#606b70' },
}

const affiliations = jsonData => {
    const note = jsonData.info?.notes?.note;
    if (note && note["@type"] === "affiliation")
        return note.text;
    else return '';
}


export async function searchAuthor(query) {
    const prefix = "https://dblp.org/pid/";
    const pid = url => url.substring(prefix.length);
    try {
        const url = 'https://dblp.org/search/author/api/?format=json&q=' + query;
        const response = await fetch(url);
        const data = await response.json();
        const hits = data.result.hits;

        if (hits['@total'] === "0") {
            return []
        } else {

            return hits.hit.map(hit => ({
                author: hit.info.author,
                pid: pid(hit.info.url),
                affiliation: affiliations(hit),
            }));
        }
    } catch (error) {
        console.error('Error fetching author:', error);
        return [];
    }
}

export async function fetchAuthor(authorPID) {
    try {
        // Make an HTTP request to the DBLP API using fetch
        const response = await fetch(`https://dblp.org/pid/${authorPID}.xml`);

        // Check if the response status is OK (200)
        if (!response.ok) {
            throw new Error(`HTTP error! Status: ${response.status}`);
        }

        // Parse the XML response
        const xmlData = await response.text();
        const parser = new xml2js.Parser({ explicitArray: false });
        const result = await parser.parseStringPromise(xmlData);
        return result;
    } catch (error) {
        console.error('Error fetching author:', error);
        return [];
    }
}

export function getName(author) {
    return author?.dblpperson?.$?.name;
}

// Function to fetch the last n publications of an author on DBLP
export function getPublications(author, n) {
    try {
        // Extract the publications
        const publications = ensureArray(author?.dblpperson?.r);

        // Get the last n publications without empty objects
        const lastNPublications = [];
        for (const publication of publications) {
            if (n && lastNPublications.length >= n) {
                break;
            }
            const publicationObject = {};
            if (publication.inproceedings) {
                publicationObject.type = 'inproceedings';
                publicationObject.authors = ensureArray(publication?.inproceedings?.author).map(author => author._);
                publicationObject.venue = publication.inproceedings.booktitle;
                publicationObject.dblp = publication.inproceedings;
            } else if (publication.article) {
                publicationObject.type = (publication.article.$?.publtype === 'informal') ? 'informal' : 'article';
                publicationObject.authors = ensureArray(publication?.article?.author).map(author => author._);
                publicationObject.venue = publication.article.journal
                publicationObject.dblp = publication.article;
            } else if (publication.proceedings) {
                publicationObject.type = 'proceedings';
                publicationObject.authors = ensureArray(publication?.proceedings?.editor).map(author => author._);
                publicationObject.venue = publication.proceedings.booktitle
                publicationObject.dblp = publication.proceedings;
            } else if (publication.book) {
                if (publication.book?.$?.publtype === 'habil') {
                    publicationObject.venue = publication.school
                } else {
                    publicationObject.venue = publication.book.publisher;
                }
                publicationObject.type = 'book';
                publicationObject.authors = ensureArray(publication?.book?.author).map(author => author._);
                publicationObject.dblp = publication.book;
            } else if (publication.incollection) {
                publicationObject.type = 'incollection';
                publicationObject.authors = ensureArray(publication?.incollection?.author).map(author => author._);
                publicationObject.venue = publication.incollection.booktitle;
                publicationObject.dblp = publication.incollection;
            } else if (publication.phdthesis) {
                publicationObject.type = 'book';
                publicationObject.authors = ensureArray(publication?.phdthesis?.author).map(author => author._);
                publicationObject.venue = 'PhD Thesis';
                publicationObject.dblp = publication.phdthesis;
            }

            if (Object.keys(publicationObject).length > 0) {
                lastNPublications.push(publicationObject);
            }
        }

        return lastNPublications;
    } catch (error) {
        console.error('Error fetching publications:', error);
        return [];
    }
}






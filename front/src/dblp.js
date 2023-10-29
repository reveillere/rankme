
import { ensureArray } from './utils';

export const dblpCategories = {
    'article': { name: 'Journal articles', letter: 'j', color: '#c32b72' },
    'inproceedings': { name: 'Conference and Workshop Papers', letter: 'c', color: '#196ca3' },
    'proceedings': { name: 'Editorship', letter: 'e', color: '#33c3ba' },
    'book': { name: 'Books and Theses', letter: 'b', color: '#f8c91f' },
    'incollection': { name: 'Parts in Books or Collections', letter: 'p', color: '#ef942d' },
    'informal': { name: 'Informal and Other Publications', letter: 'i', color: '#606b70' },
}



export async function searchAuthor(query) {
    const resp = await fetch(`/api/dblp/search/${query}`);
    return await resp.json();
}

export async function fetchAuthor(authorPID) {
        const resp = await fetch(`/api/dblp/author/${authorPID}`);
        return await resp.json();
}


export async function getVenueTitle(publication) {
    const resp = await fetch(`/api/dblp/venue/${publication.dblp.url}`);
    return await resp.json();
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
                publicationObject.authors = ensureArray(publication?.inproceedings?.author);
                publicationObject.venue = publication.inproceedings.booktitle;
                publicationObject.dblp = publication.inproceedings;
            } else if (publication.article) {
                publicationObject.type = (publication.article.$?.publtype === 'informal') ? 'informal' : 'article';
                publicationObject.authors = ensureArray(publication?.article?.author);
                publicationObject.venue = publication.article.journal
                publicationObject.dblp = publication.article;
            } else if (publication.proceedings) {
                publicationObject.type = 'proceedings';
                publicationObject.authors = ensureArray(publication?.proceedings?.editor);
                publicationObject.venue = publication.proceedings.booktitle
                publicationObject.dblp = publication.proceedings;
            } else if (publication.book) {
                if (publication.book?.$?.publtype === 'habil') {
                    publicationObject.venue = publication.book.school
                    publicationObject.authors = ensureArray(publication?.book?.author);
                } else {
                    publicationObject.venue = publication.book.publisher;
                    publicationObject.authors = ensureArray(publication?.book?.editor);
                }
                publicationObject.type = 'book';
                publicationObject.dblp = publication.book;
            } else if (publication.incollection) {
                publicationObject.type = 'incollection';
                publicationObject.authors = ensureArray(publication?.incollection?.author);
                publicationObject.venue = publication.incollection.booktitle;
                publicationObject.dblp = publication.incollection;
            } else if (publication.phdthesis) {
                publicationObject.type = 'book';
                publicationObject.authors = ensureArray(publication?.phdthesis?.author);
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





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


export function getName(author) {
    return author?.dblpperson?.$?.name;
}

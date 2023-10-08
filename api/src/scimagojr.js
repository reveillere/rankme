const BASE = 'https://www.scimagojr.com/journalrank.php?out=xls&year='

export async function fetchDB(year) {
    const resp = await fetch(`${BASE}${year}`);
    const text = await resp.text();
    return text;
}

export async function loadDB() {
    const data = await fetchDB(2022);
    
}
const TTL = 60 * 60 * 1000; // 1 heure en millisecondes

function setData(key, value) {
    const now = new Date().getTime();
    const item = {
        value: value,
        expiry: now + TTL,
    };
    localStorage.setItem(key, JSON.stringify(item));
}

function getData(key) {
    const itemStr = localStorage.getItem(key);

    if (!itemStr) {
        return null;
    }

    const item = JSON.parse(itemStr);
    const now = new Date().getTime();

    if (now > item.expiry) {
        localStorage.removeItem(key);
        return null;
    }

    return item.value;
}

export default async function withCache(key, fn) {
    const cachedData = getData(key);

    if (cachedData) {
        return cachedData;
    }

    try {
        const data = await fn();
        setData(key, data);
        return data;
    } catch (error) {
        console.error(`Error fetching data for key ${key}:`, error);
        throw error;
    }
}
import fetch from 'node-fetch';
import crypto from 'crypto';
import { MongoClient } from 'mongodb';
import { parseStringPromise } from 'xml2js';
import { pipeline } from 'stream';
import gunzip from 'gunzip-maybe';
import { createWriteStream, statSync, createReadStream } from 'fs';
import { writeFile, readFile } from 'fs/promises';
import { Parser } from 'xml2js';
import sax from 'sax';
import { v4 as uuidv4 } from 'uuid';
import { getClient } from './db.js';


const DBLP_XML_URL = 'https://dblp.org/xml/dblp.xml.gz';
const DBLP_MD5_URL = 'https://dblp.org/xml/dblp.xml.gz.md5';

function printProgress(current, total, msg='Progression') {
    const percentage = ((current / total) * 100).toFixed(2);
    process.stdout.write(`${msg}: ${percentage}%\r`);
    // process.stdout.clearLine();
    //         process.stdout.cursorTo(0);
    //         process.stdout.write(`Download progress: ${percentage}%`);
}

const downloadFile = async () => {
    const response = await fetch(DBLP_XML_URL);
    const totalSize = Number(response.headers.get('content-length'));
    let downloadedSize = 0;

    const writer = createWriteStream('./dblp.xml.gz');

    await new Promise((resolve, reject) => {
        response.body.on('data', (chunk) => {
            downloadedSize += chunk.length;
            printProgress(downloadedSize, totalSize, 'Download');
        });

        pipeline(response.body, writer, (err) => {
            if (err) reject(err);
            else {
                console.log('\nDownload completed!');
                resolve();
            }
        });
    });
};

const getCurrentMD5 = async () => {
    const md5Response = await fetch(DBLP_MD5_URL);
    const md5Content = await md5Response.text();
    const md5Expected = md5Content.split(' ')[0];
    return md5Expected;
};

const storeMD5 = async (md5Value) => {
    await writeFile('./localMD5.txt', md5Value, 'utf-8');
};

const getStoredMD5 = async () => {
    try {
        return await readFile('./localMD5.txt', 'utf-8');
    } catch (error) {
        return null;
    }
};

const verifyMD5 = async (md5Expected) => {
    const hash = crypto.createHash('md5');
    const fileStream = createReadStream('./dblp.xml.gz');

    await new Promise((resolve, reject) => {
        fileStream.on('data', (chunk) => {
            hash.update(chunk);
        });
        fileStream.on('end', resolve);
        fileStream.on('error', reject);
    });

    const md5Actual = hash.digest('hex');
    console.log(`Actual MD5: ${md5Actual}`);
    console.log(`Expected MD5: ${md5Expected}`)
    if (md5Actual !== md5Expected) {
        throw new Error('MD5 checksum mismatch');
    }
};



const decompressFile = async () => {
    const totalSize = statSync('./dblp.xml.gz').size;  // obtenir la taille du fichier gz
    let readSize = 0;

    const reader = createReadStream('./dblp.xml.gz');
    const writer = createWriteStream('./dblp.xml');
    const unzip = gunzip();

    await new Promise((resolve, reject) => {
        pipeline(reader, unzip, writer, (err) => {
            if (err) reject(err);
            else resolve();
        });

        reader.on('data', (chunk) => {
            readSize += chunk.length;
            printProgress(readSize, totalSize, 'Decompression');
        });
    });

    console.log('\nDecompression completed!');
};


const BATCH_SIZE = 10000;


const processXML = async (filePath) => {
    const client = getClient();
    await client.connect();
    const db = client.db("dblp");

    const parser = sax.createStream(true);
    const fileStream = createReadStream(filePath);
    const totalSize = statSync(filePath).size;
    let readSize = 0;
    let currentNode = null;
    let currentObject = {};
    let lastNodeName = null;
    const validNodes = ['article', 'inproceedings', 'proceedings', 'book', 'incollection', 'phdthesis', 'mastersthesis', 'www', 'person', 'data'];

    for (let nodeType of validNodes) {
        const collection = db.collection(nodeType);
        await collection.deleteMany({});
    }

    // Création des files d'attente pour chaque type de nœud
    const queues = validNodes.reduce((acc, nodeName) => {
        acc[nodeName] = [];
        return acc;
    }, {});

    const processingQueues = new Set();

    const insertBatch = async (collectionName, batch) => {
        const collection = db.collection(collectionName);
        console.log(`\nInserting ${batch.length} documents in  ${collectionName}...`);
        await collection.insertMany(batch);
    };

    const processInsertionQueue = async (nodeType) => {
        if (processingQueues.has(nodeType)) {
            return;
        }
        processingQueues.add(nodeType);

        const queue = queues[nodeType];
        while (queue.length > BATCH_SIZE) {
            const batch = queue.splice(0, BATCH_SIZE);
            await insertBatch(nodeType, batch);
        }

        processingQueues.delete(nodeType);
    };

    parser.on('opentag', (node) => {
        if (validNodes.includes(node.name)) {
            currentNode = node.name;
            currentObject = {
                _id: uuidv4()
            };
        } else if (currentNode) {
            lastNodeName = node.name;
            currentObject[lastNodeName] = '';
        }
    });

    parser.on('text', (text) => {
        if (lastNodeName && currentObject.hasOwnProperty(lastNodeName)) {
            currentObject[lastNodeName] += text.trim();
        }
    });

    parser.on('closetag', (nodeName) => {
        if (validNodes.includes(nodeName) && currentNode === nodeName) {
            queues[currentNode].push(currentObject);

            if (queues[currentNode].length >= BATCH_SIZE) {
                processInsertionQueue(currentNode);
            }

            currentNode = null;
            currentObject = {};
        }
    });

    fileStream.on('data', (chunk) => {
        readSize += chunk.length;
        printProgress(readSize, totalSize, 'Copy to DB');
        parser.write(chunk);
    });

    fileStream.on('end', async () => {
        for (let nodeType of validNodes) {
            if (queues[nodeType].length > 0) {
                await processInsertionQueue(nodeType);
            }
        }
        console.log('\nProcessing completed!');
        client.close();
    });

    fileStream.on('error', (error) => {
        console.error('Error reading the file:', error.message);
    });
};

import { getVenueFullName } from './dblp.js';

async function venueLookup() {
    const BATCH_SIZE = 100;
    try {
        console.log(`Processing proceedings, extracting venues ...`);
        const client = await getClient();

        await client.connect();
        const db = client.db("dblp");
        const proceedings = db.collection('proceedings');
        const venues = db.collection('venues');
        venues.deleteMany({});

        const filter = {
            'url': {
                '$regex': '^db/conf.*\.html$'
            }
        }

        // Obtenez le nombre total d'enregistrements
        const totalRecords = await proceedings.countDocuments(filter);
        console.log(`Number of records to process: ${totalRecords}`);
        const cursor = proceedings.find(filter);

        let n = 0;
        let batch = [];

        printProgress(n, totalRecords, "Extracting venue");
        while (await cursor.hasNext()) {
            const doc = await cursor.next();
            let venue = await getVenueFullName(doc.url);
            if (venue === "") {
                venue = doc.title;
            }

            batch.push({
                _id: doc._id,
                url: doc.url,
                venue: venue
            });

            if (batch.length >= BATCH_SIZE) {
                await venues.insertMany(batch);
                n += batch.length;
                batch = []; 
                printProgress(n, totalRecords, "Extracting venue");
            }
        }

        if (batch.length > 0) {
            await venues.insertMany(batch);
            n += batch.length;
            printProgress(n, totalRecords, "Extracting venue");
        }

        console.log(`\nProcessing completed!`);
    } catch (err) {
        console.error("Error during processing of proceedings", err);
    }
}


const main = async () => {
    try {
        const currentMD5 = await getCurrentMD5();
        const storedMD5 = await getStoredMD5();

        if (storedMD5 !== currentMD5) {
            console.log('File has been updated. Downloading...');

            console.log(`Current MD5: ${currentMD5}`);
            await downloadFile();
            await verifyMD5(currentMD5);
            await storeMD5(currentMD5);
            console.log('MD5 verification passed!');
            await decompressFile();
        } else {
            console.log('File has not been updated. No need to download.');
        }
        await processXML('./dblp.xml');
        await venueLookup();
        console.log('FINITO!!!!');
    } catch (error) {
        console.error('Error:', error.message);
    }
};

// main();

async function main2() {
    await venueLookup();
}

main()

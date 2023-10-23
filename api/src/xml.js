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


const DBLP_XML_URL = 'https://dblp.org/xml/dblp.xml.gz';
const DBLP_MD5_URL = 'https://dblp.org/xml/dblp.xml.gz.md5';

const mongoURI = 'mongodb://localhost:27017';

const client = new MongoClient(mongoURI);

const downloadFile = async () => {
    const response = await fetch(DBLP_XML_URL);
    const totalSize = Number(response.headers.get('content-length'));
    let downloadedSize = 0;

    const writer = createWriteStream('./dblp.xml.gz');

    await new Promise((resolve, reject) => {
        response.body.on('data', (chunk) => {
            downloadedSize += chunk.length;
            const percentage = ((downloadedSize / totalSize) * 100).toFixed(2);
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Download progress: ${percentage}%`);
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

        // Sur chaque morceau de données lues (et non décompressées), mettez à jour le pourcentage
        reader.on('data', (chunk) => {
            readSize += chunk.length;
            const percentage = ((readSize / totalSize) * 100).toFixed(2);
            process.stdout.clearLine();
            process.stdout.cursorTo(0);
            process.stdout.write(`Decompression progress: ${percentage}%`);
        });
    });

    console.log('\nDecompression completed!');
};



const processXML = async (filePath) => {
    const BATCH_SIZE = 1000;  

    await client.connect();
    const db = client.db("dblp");

    const articlesCollection = db.collection('articles');
    const inproceedingsCollection = db.collection('inproceedings');

    await inproceedingsCollection.deleteMany({});
    await articlesCollection.deleteMany({});

    const parser = sax.createStream(true);
    const fileStream = createReadStream(filePath);
    const totalSize = statSync(filePath).size;
    let readSize = 0;
    let currentNode = null;
    let currentObject = {};
    let lastNodeName = null;
    let articlesBatch = [];
    let inproceedingsBatch = [];

    const insertBatch = async (collection, batch) => {
        for (const doc of batch) {
            try {
                await collection.insertOne(doc);
            } catch (err) {
                if (err.code !== 11000) {  // Si ce n'est pas une erreur de doublon
                    throw err;
                }
                // Si c'est une erreur de doublon, l'ignorer
            }
        }
        batch.length = 0;  // Vider le batch après l'insertion
    };

    parser.on('opentag', (node) => {
        if (node.name === 'inproceedings' || node.name === 'article') {
            currentNode = node.name;
            currentObject = {
                ...node.attributes,
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

    parser.on('closetag', async (nodeName) => {
        if ((nodeName === 'inproceedings' && currentNode === 'inproceedings') ||
            (nodeName === 'article' && currentNode === 'article')) {
            
            // Ne pas ajouter à la batch si le champ url contient un #
            if (!currentObject.url || !currentObject.url.includes('#')) {
                if (nodeName === 'inproceedings') {
                    inproceedingsBatch.push(currentObject);
                    if (inproceedingsBatch.length >= BATCH_SIZE) {
                        await insertBatch(inproceedingsCollection, inproceedingsBatch);
                    }
                } else {
                    articlesBatch.push(currentObject);
                    if (articlesBatch.length >= BATCH_SIZE) {
                        await insertBatch(articlesCollection, articlesBatch);
                    }
                }
            }
            currentNode = null;
            currentObject = {};
        }
    });

    fileStream.on('data', (chunk) => {
        readSize += chunk.length;
        const percentage = ((readSize / totalSize) * 100).toFixed(2);
        process.stdout.clearLine();
        process.stdout.cursorTo(0);
        process.stdout.write(`Processing dblp: ${percentage}%`);
        parser.write(chunk);
    });

    fileStream.on('end', async () => {
        await insertBatch(articlesCollection, articlesBatch);
        await insertBatch(inproceedingsCollection, inproceedingsBatch);
        console.log('\nProcessing completed!');
        client.close();
    });

    fileStream.on('error', (error) => {
        console.error('Error reading the file:', error.message);
    });
};





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
        processXML('./dblp.xml');
    } catch (error) {
        console.error('Error:', error.message);
    }
};

main();

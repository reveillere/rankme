// Importer les modules nécessaires
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import Papa from 'papaparse';
import HTMLParser from 'node-html-parser';


// Initialiser l'application Express
const app = express();
const port = 3000;

const coreURL = 'http://portal.core.edu.au/conf-ranks/';
const querySource = '?search=&by=all&do=Export&source='

// Définir les routes
app.use(cors());


app.get('/core/source/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${coreURL}${querySource}${id}`;
    const text = await loadPage(url);
    res.send(text);
  } catch (e) {
    console.error('Fetch Error: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
});


export async function loadPage(url) {
  try {
     console.log('Loading page:', url);
      const resp = await fetch(url);
      if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
      const text = await resp.text();
      return text;
  } catch (e) {
      console.error('Fetch Error: ', e);
      throw e; 
  }   
}

async function parseRankSource(txt) {
  try {
      const headers = ['id', 'title', 'acronym', 'source', 'rank', 'm1', 'm2', 'm3', 'm4'];
      
      const results = await Papa.parse(txt, {
          header: true,
          beforeFirstChunk: function (chunk) {
              const rows = chunk.split(/\r\n|\r|\n/);
              rows.unshift(headers.join());
              return rows.join('\r\n');
          }
      });
      
      return results.data;
  } catch (e) {
      console.error('Fetch Error: ', e);
      throw e;
  }
}


function extractSources(list) {
  const result = [];
  const yearRegex = /\d+/g;
  
  list.forEach(item => {
      const trimmedItem = item.trim(); 
      if (trimmedItem === 'All') return; 
      
      const matches = trimmedItem.match(yearRegex) || [];
      matches.forEach(match => {
          if (match.length === 4) { 
              result.push({
                  year: parseInt(match, 10), 
                  source: trimmedItem
              });
          }
      });
  });    
  return result;
}


app.get('/core/sources', async (req, res) => {
  try {
    console.log('Loading page:', coreURL);
    const resp = await fetch(coreURL);
    if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
    const text = await resp.text();
    res.send(text);
  } catch (e) {
    console.error('Fetch Error: ', e);
    res.status(500).send('Internal Server Error');
  }
});




app.get('/core/ranks', async (req, res) => {
  try {
      const main = await loadPage(`${coreURL}`);
      const dom = HTMLParser.parse(main);
      const options = dom.querySelectorAll('select[name=source] option');
      const sources = extractSources(options.map(o => o.rawText));

      const promises = sources.map(async item => {
          try {
              const rankRaw = await loadPage(`${coreURL}${querySource}${item.source}`);
              item.ranks = await parseRankSource(rankRaw);
          } catch (e) {
              console.error('Error loading and parsing rank for source:', item.source, e);
          }
      });

      await Promise.all(promises);

      res.json(sources);
  } catch (e) {
    console.error('Fetch Error: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
});



// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});
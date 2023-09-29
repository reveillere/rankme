// Importer les modules nécessaires
import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';

// Initialiser l'application Express
const app = express();
const port = 3000;

const core = 'http://portal.core.edu.au/conf-ranks/';
const querySource = '?search=&by=all&do=Export&source='

// Définir les routes
app.use(cors());


app.get('/core/source/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const url = `${core}${querySource}${id}`;
    console.log('Loading page:', url);

    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
    const text = await resp.text();
    res.send(text);
  } catch (e) {
    console.error('Fetch Error: ', e);
    res.status(500).json({ error: 'Internal Server Error', message: e.message });
  }
});



app.get('/core/sources', async (req, res) => {
  try {
    console.log('Loading page:', core);
    const resp = await fetch(core);
    if (!resp.ok) throw new Error(`HTTP error! Status: ${resp.status}`);
    const text = await resp.text();
    res.send(text);
  } catch (e) {
    console.error('Fetch Error: ', e);
    res.status(500).send('Internal Server Error');
  }
});
// Démarrer le serveur
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}`);
});

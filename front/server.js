import express from 'express';
import path from 'path';

const app = express();

const PORT = 80;

app.use(express.static('./dist'));

// Démarrage du serveur
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

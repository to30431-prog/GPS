const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname), {
    setHeaders: (res, filePath) => {
        if (filePath.endsWith('sw.js') || filePath.endsWith('index.html') || filePath.endsWith('app.js') || filePath.endsWith('style.css')) {
            res.setHeader('Cache-Control', 'no-cache');
        }
    }
}));

app.use((req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
});

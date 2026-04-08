let app;
try {
    app = require('../index.js');
} catch (e) {
    console.error('Failed to load app:', e.message, e.stack);
    app = (req, res) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Server failed to start', detail: e.message }));
    };
}
module.exports = app;

const app = require('./api/index');
const port = process.env.PORT || 3000;
app.listen(port, '0.0.0.0', () => console.log(`API server running on http://0.0.0.0:${port}`));

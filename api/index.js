// Serverless function Vercel: semua request /api/* diteruskan ke aplikasi Express di backend/.
// Tunggu tabel database siap dulu (penting saat cold start pertama di database yang masih kosong).
const app = require('../backend/server');
const db = require('../backend/database/db');

module.exports = async (req, res) => {
    await db.ready;
    return app(req, res);
};

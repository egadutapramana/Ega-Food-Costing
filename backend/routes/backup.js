const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { runBackup, listBackups } = require('../utils/backup');

// GET daftar backup yang ada (admin only) - cuma relevan untuk mode SQLite lokal
router.get('/', requireAdmin, (req, res) => {
    res.json(listBackups());
});

// POST backup manual sekarang juga (admin only) - cuma relevan untuk mode SQLite lokal
router.post('/', requireAdmin, (req, res) => {
    const backupPath = runBackup();
    if (!backupPath) return res.status(500).json({ error: 'Gagal membuat backup: file database tidak ditemukan' });
    res.json({ message: 'Backup berhasil dibuat', path: backupPath });
});

const EXPORT_TABLES = [
    'suppliers',
    'ingredient_categories',
    'recipe_categories',
    'ingredients',
    'ingredient_price_history',
    'recipes',
    'recipe_ingredients'
];

// GET export seluruh data bisnis (bukan akun user) sebagai satu file JSON yang bisa diunduh.
// Berfungsi di mode SQLite maupun PostgreSQL. Sengaja tidak menyertakan tabel users (ada password hash).
router.get('/export', requireAdmin, async (req, res) => {
    try {
        const dump = {};
        for (const table of EXPORT_TABLES) {
            dump[table] = await new Promise((resolve, reject) => {
                db.all(`SELECT * FROM ${table}`, [], (err, rows) => (err ? reject(err) : resolve(rows)));
            });
        }
        dump._exported_at = new Date().toISOString();

        const filename = `food-cost-backup-${new Date().toISOString().slice(0, 10)}.json`;
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.send(JSON.stringify(dump, null, 2));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

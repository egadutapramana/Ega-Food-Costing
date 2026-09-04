const express = require('express');
const router = express.Router();
const { requireAdmin } = require('../middleware/auth');
const { runBackup, listBackups } = require('../utils/backup');

// GET daftar backup yang ada (admin only)
router.get('/', requireAdmin, (req, res) => {
    res.json(listBackups());
});

// POST backup manual sekarang juga (admin only)
router.post('/', requireAdmin, (req, res) => {
    const backupPath = runBackup();
    if (!backupPath) return res.status(500).json({ error: 'Gagal membuat backup: file database tidak ditemukan' });
    res.json({ message: 'Backup berhasil dibuat', path: backupPath });
});

module.exports = router;

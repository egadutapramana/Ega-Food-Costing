const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isNonEmptyString } = require('../utils/validate');
const { requireAdmin } = require('../middleware/auth');

router.get('/', (req, res) => {
    db.all('SELECT * FROM suppliers ORDER BY name COLLATE NOCASE', [], (err, rows) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(rows);
    });
});

router.post('/', (req, res) => {
    const name = (req.body.name || '').trim();
    const contact = (req.body.contact || '').trim();

    if (!isNonEmptyString(name)) {
        return res.status(400).json({ error: 'Nama supplier tidak boleh kosong' });
    }

    db.get('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?)', [name], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) {
            return res.status(400).json({ error: 'Supplier dengan nama ini sudah ada' });
        }

        db.run('INSERT INTO suppliers (name, contact) VALUES (?, ?)', [name, contact], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            res.json({ id: this.lastID, name, contact });
        });
    });
});

// PUT update supplier
router.put('/:id', (req, res) => {
    const supplierId = req.params.id;
    const name = (req.body.name || '').trim();
    const contact = (req.body.contact || '').trim();

    if (!isNonEmptyString(name)) {
        return res.status(400).json({ error: 'Nama supplier tidak boleh kosong' });
    }

    db.get('SELECT id FROM suppliers WHERE LOWER(name) = LOWER(?) AND id != ?', [name, supplierId], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) {
            return res.status(400).json({ error: 'Supplier dengan nama ini sudah ada' });
        }

        db.run('UPDATE suppliers SET name = ?, contact = ? WHERE id = ?', [name, contact, supplierId], function (err) {
            if (err) return res.status(500).json({ error: err.message });
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Supplier tidak ditemukan' });
            }
            res.json({ id: Number(supplierId), name, contact });
        });
    });
});

// DELETE supplier (dengan pengecekan apakah masih dipakai di ingredients)
router.delete('/:id', requireAdmin, (req, res) => {
    const supplierId = req.params.id;

    // Cek dulu apakah supplier ini masih dipakai di ingredient manapun
    db.get(
        'SELECT COUNT(*) as count FROM ingredients WHERE supplier_id = ?',
        [supplierId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row.count > 0) {
                return res.status(400).json({
                    error: `Tidak bisa menghapus supplier ini karena masih dipakai di ${row.count} bahan baku. Ubah atau hapus dulu bahan yang terkait.`
                });
            }

            // Kalau aman, baru hapus
            db.run('DELETE FROM suppliers WHERE id = ?', [supplierId], function (err) {
                if (err) return res.status(500).json({ error: err.message });

                if (this.changes === 0) {
                    return res.status(404).json({ error: 'Supplier tidak ditemukan' });
                }

                res.json({ message: 'Supplier deleted', changes: this.changes });
            });
        }
    );
});

module.exports = router;

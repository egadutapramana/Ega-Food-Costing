const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString } = require('../utils/validate');

// Bikin sub-router CRUD kategori untuk satu jenis (bahan atau resep).
// categoryTable: tabel kategori itu sendiri. parentTable: tabel yang menyimpan nama kategori (ingredients/recipes).
function buildCategoryRoutes(categoryTable, parentTable) {
    const sub = express.Router();

    sub.get('/', (req, res) => {
        db.all(`SELECT * FROM ${categoryTable} ORDER BY name COLLATE NOCASE`, [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
    });

    sub.post('/', requireAdmin, (req, res) => {
        const name = (req.body.name || '').trim();
        if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Nama kategori tidak boleh kosong' });

        db.get(`SELECT id FROM ${categoryTable} WHERE LOWER(name) = LOWER(?)`, [name], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });
            if (existing) return res.status(400).json({ error: 'Kategori dengan nama ini sudah ada' });

            db.run(`INSERT INTO ${categoryTable} (name) VALUES (?)`, [name], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, name });
            });
        });
    });

    // Ganti nama kategori. Semua data (ingredient/recipe) yang masih memakai nama lama ikut diupdate otomatis.
    sub.put('/:id', requireAdmin, (req, res) => {
        const id = req.params.id;
        const name = (req.body.name || '').trim();
        if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Nama kategori tidak boleh kosong' });

        db.get(`SELECT * FROM ${categoryTable} WHERE id = ?`, [id], (err, current) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!current) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

            db.get(`SELECT id FROM ${categoryTable} WHERE LOWER(name) = LOWER(?) AND id != ?`, [name, id], (err, existing) => {
                if (err) return res.status(500).json({ error: err.message });
                if (existing) return res.status(400).json({ error: 'Kategori dengan nama ini sudah ada' });

                db.run(`UPDATE ${categoryTable} SET name = ? WHERE id = ?`, [name, id], function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    db.run(`UPDATE ${parentTable} SET category = ? WHERE category = ?`, [name, current.name], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ id: Number(id), name });
                    });
                });
            });
        });
    });

    sub.delete('/:id', requireAdmin, (req, res) => {
        const id = req.params.id;

        db.get(`SELECT * FROM ${categoryTable} WHERE id = ?`, [id], (err, current) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!current) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

            db.get(`SELECT COUNT(*) as count FROM ${parentTable} WHERE category = ?`, [current.name], (err, countRow) => {
                if (err) return res.status(500).json({ error: err.message });
                if (countRow.count > 0) {
                    return res.status(400).json({
                        error: `Tidak bisa menghapus kategori ini karena masih dipakai di ${countRow.count} data. Ubah dulu kategori data terkait, atau ganti nama kategori ini.`
                    });
                }

                db.run(`DELETE FROM ${categoryTable} WHERE id = ?`, [id], function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    res.json({ message: 'Kategori dihapus' });
                });
            });
        });
    });

    return sub;
}

router.use('/ingredients', buildCategoryRoutes('ingredient_categories', 'ingredients'));
router.use('/recipes', buildCategoryRoutes('recipe_categories', 'recipes'));

module.exports = router;

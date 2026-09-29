const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { requireAdmin } = require('../middleware/auth');
const { isNonEmptyString } = require('../utils/validate');

// Bikin sub-router CRUD kategori untuk satu jenis (bahan atau resep).
// categoryTable: tabel kategori itu sendiri. parentTable: tabel yang menyimpan nama kategori (ingredients/recipes).
// supportsBasedProductFlag: true khusus untuk recipe_categories, supaya kategori bisa ditandai
// "based product" (resep berkategori ini otomatis dibuatkan/disinkronkan bahan bakunya sendiri).
function buildCategoryRoutes(categoryTable, parentTable, supportsBasedProductFlag = false) {
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
        const isBasedProductCategory = supportsBasedProductFlag ? Boolean(req.body.is_based_product_category) : false;

        db.get(`SELECT id FROM ${categoryTable} WHERE LOWER(name) = LOWER(?)`, [name], (err, existing) => {
            if (err) return res.status(500).json({ error: err.message });
            if (existing) return res.status(400).json({ error: 'Kategori dengan nama ini sudah ada' });

            const columns = supportsBasedProductFlag ? '(name, is_based_product_category)' : '(name)';
            const placeholders = supportsBasedProductFlag ? '(?, ?)' : '(?)';
            // Kolom ini INTEGER (bukan BOOLEAN) di database lama yang sudah dimigrasi, jadi kirim 0/1, bukan true/false JS
            const params = supportsBasedProductFlag ? [name, isBasedProductCategory ? 1 : 0] : [name];

            db.run(`INSERT INTO ${categoryTable} ${columns} VALUES ${placeholders}`, params, function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, name, ...(supportsBasedProductFlag ? { is_based_product_category: isBasedProductCategory } : {}) });
            });
        });
    });

    // Ganti nama kategori (dan, kalau relevan, status "based product"-nya).
    // Semua data (ingredient/recipe) yang masih memakai nama lama ikut diupdate otomatis.
    sub.put('/:id', requireAdmin, (req, res) => {
        const id = req.params.id;
        const name = (req.body.name || '').trim();
        if (!isNonEmptyString(name)) return res.status(400).json({ error: 'Nama kategori tidak boleh kosong' });
        const isBasedProductCategory = supportsBasedProductFlag ? Boolean(req.body.is_based_product_category) : false;

        db.get(`SELECT * FROM ${categoryTable} WHERE id = ?`, [id], (err, current) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!current) return res.status(404).json({ error: 'Kategori tidak ditemukan' });

            db.get(`SELECT id FROM ${categoryTable} WHERE LOWER(name) = LOWER(?) AND id != ?`, [name, id], (err, existing) => {
                if (err) return res.status(500).json({ error: err.message });
                if (existing) return res.status(400).json({ error: 'Kategori dengan nama ini sudah ada' });

                const setClause = supportsBasedProductFlag ? 'name = ?, is_based_product_category = ?' : 'name = ?';
                // Kolom ini INTEGER (bukan BOOLEAN) di database lama yang sudah dimigrasi, jadi kirim 0/1, bukan true/false JS
                const params = supportsBasedProductFlag ? [name, isBasedProductCategory ? 1 : 0, id] : [name, id];

                db.run(`UPDATE ${categoryTable} SET ${setClause} WHERE id = ?`, params, function (err) {
                    if (err) return res.status(500).json({ error: err.message });

                    db.run(`UPDATE ${parentTable} SET category = ? WHERE category = ?`, [name, current.name], (err) => {
                        if (err) return res.status(500).json({ error: err.message });
                        res.json({ id: Number(id), name, ...(supportsBasedProductFlag ? { is_based_product_category: isBasedProductCategory } : {}) });
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
router.use('/recipes', buildCategoryRoutes('recipe_categories', 'recipes', true));

module.exports = router;

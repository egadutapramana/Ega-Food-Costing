const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isNonEmptyString, isValidPrice } = require('../utils/validate');
const { requireAdmin } = require('../middleware/auth');

// GET ingredients - mendukung search, filter supplier/kategori, dan pagination lewat query params.
// Tanpa query params sama sekali: kembalikan array penuh (dipakai dropdown & kalkulasi resep).
router.get('/', (req, res) => {
    const { search, supplier_id, category, page, limit } = req.query;

    if (!search && !supplier_id && !category && !page && !limit) {
        db.all('SELECT * FROM ingredients ORDER BY name COLLATE NOCASE', [], (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        });
        return;
    }

    const conditions = [];
    const params = [];

    if (search) {
        conditions.push('name LIKE ?');
        params.push(`%${search.trim()}%`);
    }
    if (supplier_id) {
        conditions.push('supplier_id = ?');
        params.push(supplier_id);
    }
    if (category) {
        conditions.push('category = ?');
        params.push(category);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.max(parseInt(limit) || 10, 1);
    const offset = (pageNum - 1) * limitNum;

    db.get(`SELECT COUNT(*) as total FROM ingredients ${whereClause}`, params, (err, countRow) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(
            `SELECT * FROM ingredients ${whereClause} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
            [...params, limitNum, offset],
            (err, rows) => {
                if (err) return res.status(500).json({ error: err.message });
                res.json({
                    data: rows,
                    total: countRow.total,
                    page: pageNum,
                    limit: limitNum,
                    totalPages: Math.max(Math.ceil(countRow.total / limitNum), 1)
                });
            }
        );
    });
});

// GET satu ingredient by id
router.get('/:id', (req, res) => {
    db.get('SELECT * FROM ingredients WHERE id = ?', [req.params.id], (err, row) => {
        if (err) return res.status(500).json({ error: err.message });
        res.json(row);
    });
});

// GET riwayat harga satu ingredient
router.get('/:id/price-history', (req, res) => {
    db.all(
        'SELECT price_per_unit, changed_at FROM ingredient_price_history WHERE ingredient_id = ? ORDER BY changed_at DESC, id DESC',
        [req.params.id],
        (err, rows) => {
            if (err) return res.status(500).json({ error: err.message });
            res.json(rows);
        }
    );
});

function validateIngredientInput(body) {
    const name = (body.name || '').trim();
    const unit = (body.unit || '').trim();

    if (!isNonEmptyString(name)) return 'Nama bahan tidak boleh kosong';
    if (!isNonEmptyString(unit)) return 'Satuan tidak boleh kosong';
    if (!isValidPrice(body.price_per_unit)) return 'Harga per satuan harus berupa angka dan tidak boleh negatif';
    return null;
}

// POST tambah ingredient baru
router.post('/', (req, res) => {
    const name = (req.body.name || '').trim();
    const unit = (req.body.unit || '').trim();
    const category = (req.body.category || '').trim() || null;
    const { price_per_unit, supplier_id } = req.body;

    const validationError = validateIngredientInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    db.get('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)', [name], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) return res.status(400).json({ error: 'Bahan dengan nama ini sudah ada' });

        const sql = `INSERT INTO ingredients (name, unit, price_per_unit, supplier_id, category) VALUES (?, ?, ?, ?, ?)`;
        db.run(sql, [name, unit, price_per_unit, supplier_id || null, category], function (err) {
            if (err) return res.status(500).json({ error: err.message });

            const ingredientId = this.lastID;
            db.run('INSERT INTO ingredient_price_history (ingredient_id, price_per_unit) VALUES (?, ?)', [ingredientId, price_per_unit]);

            res.json({ id: ingredientId, name, unit, price_per_unit, supplier_id, category });
        });
    });
});

// PUT update ingredient
router.put('/:id', (req, res) => {
    const ingredientId = req.params.id;
    const name = (req.body.name || '').trim();
    const unit = (req.body.unit || '').trim();
    const category = (req.body.category || '').trim() || null;
    const { price_per_unit, supplier_id } = req.body;

    const validationError = validateIngredientInput(req.body);
    if (validationError) return res.status(400).json({ error: validationError });

    db.get('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?) AND id != ?', [name, ingredientId], (err, existing) => {
        if (err) return res.status(500).json({ error: err.message });
        if (existing) return res.status(400).json({ error: 'Bahan dengan nama ini sudah ada' });

        db.get('SELECT price_per_unit FROM ingredients WHERE id = ?', [ingredientId], (err, current) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!current) return res.status(404).json({ error: 'Bahan tidak ditemukan' });

            const priceChanged = Number(current.price_per_unit) !== Number(price_per_unit);

            const sql = `UPDATE ingredients SET name=?, unit=?, price_per_unit=?, supplier_id=?, category=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`;
            db.run(sql, [name, unit, price_per_unit, supplier_id || null, category, ingredientId], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                if (this.changes === 0) return res.status(404).json({ error: 'Bahan tidak ditemukan' });

                if (priceChanged) {
                    db.run('INSERT INTO ingredient_price_history (ingredient_id, price_per_unit) VALUES (?, ?)', [ingredientId, price_per_unit]);
                }

                res.json({ id: Number(ingredientId), name, unit, price_per_unit, supplier_id, category });
            });
        });
    });
});

// DELETE ingredient (dengan pengecekan apakah masih dipakai di resep)
router.delete('/:id', requireAdmin, (req, res) => {
    const ingredientId = req.params.id;

    // Cek dulu apakah ingredient ini masih dipakai di recipe manapun
    db.get(
        'SELECT COUNT(*) as count FROM recipe_ingredients WHERE ingredient_id = ?',
        [ingredientId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });

            if (row.count > 0) {
                return res.status(400).json({
                    error: `Tidak bisa menghapus bahan ini karena masih dipakai di ${row.count} resep. Hapus dulu bahan ini dari resep terkait.`
                });
            }

            // Kalau aman, baru hapus (riwayat harga ikut terhapus lewat ON DELETE CASCADE)
            db.run('DELETE FROM ingredients WHERE id = ?', [ingredientId], function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ message: 'Ingredient deleted', changes: this.changes });
            });
        }
    );
});


module.exports = router;

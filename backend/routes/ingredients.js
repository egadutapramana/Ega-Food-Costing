const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isNonEmptyString, isValidPrice, isPositiveNumber } = require('../utils/validate');
const { requireAdmin } = require('../middleware/auth');
const { resolveIngredientRow, resolveIngredientRows } = require('../utils/ingredientCost');

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve(this);
        });
    });
}

// GET ingredients - mendukung search, filter supplier/kategori, dan pagination lewat query params.
// Tanpa query params sama sekali: kembalikan array penuh (dipakai dropdown & kalkulasi resep).
// Bahan "based product" (source_recipe_id terisi) harganya dihitung otomatis dari resep sumbernya.
router.get('/', async (req, res) => {
    try {
        const { search, supplier_id, category, page, limit } = req.query;

        if (!search && !supplier_id && !category && !page && !limit) {
            const rows = await dbAll('SELECT * FROM ingredients ORDER BY name COLLATE NOCASE');
            return res.json(await resolveIngredientRows(rows));
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

        const countRow = await dbGet(`SELECT COUNT(*) as total FROM ingredients ${whereClause}`, params);
        const rows = await dbAll(
            `SELECT * FROM ingredients ${whereClause} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        res.json({
            data: await resolveIngredientRows(rows),
            total: countRow.total,
            page: pageNum,
            limit: limitNum,
            totalPages: Math.max(Math.ceil(countRow.total / limitNum), 1)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET satu ingredient by id
router.get('/:id', async (req, res) => {
    try {
        const row = await dbGet('SELECT * FROM ingredients WHERE id = ?', [req.params.id]);
        res.json(await resolveIngredientRow(row));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET riwayat harga satu ingredient (cuma relevan untuk bahan biasa, bukan based product)
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
    const isBasedProduct = Boolean(body.source_recipe_id);

    if (!isNonEmptyString(name)) return 'Nama bahan tidak boleh kosong';
    if (!isNonEmptyString(unit)) return 'Satuan tidak boleh kosong';

    if (isBasedProduct) {
        if (!isPositiveNumber(body.yield_quantity)) return 'Jumlah hasil (yield) harus berupa angka lebih dari 0';
    } else if (!isValidPrice(body.price_per_unit)) {
        return 'Harga per satuan harus berupa angka dan tidak boleh negatif';
    }
    return null;
}

// POST tambah ingredient baru (bahan biasa ATAU based product dari resep lain)
router.post('/', async (req, res) => {
    try {
        const name = (req.body.name || '').trim();
        const unit = (req.body.unit || '').trim();
        const category = (req.body.category || '').trim() || null;
        const { price_per_unit, supplier_id, source_recipe_id, yield_quantity } = req.body;
        const isBasedProduct = Boolean(source_recipe_id);

        const validationError = validateIngredientInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        if (isBasedProduct) {
            const sourceRecipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [source_recipe_id]);
            if (!sourceRecipe) return res.status(400).json({ error: 'Resep sumber tidak ditemukan' });
        }

        const existing = await dbGet('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)', [name]);
        if (existing) return res.status(400).json({ error: 'Bahan dengan nama ini sudah ada' });

        const finalPrice = isBasedProduct ? 0 : price_per_unit;
        const result = await dbRun(
            'INSERT INTO ingredients (name, unit, price_per_unit, supplier_id, category, source_recipe_id, yield_quantity) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, unit, finalPrice, supplier_id || null, category, isBasedProduct ? source_recipe_id : null, isBasedProduct ? yield_quantity : null]
        );

        const ingredientId = result.lastID;
        if (!isBasedProduct) {
            db.run('INSERT INTO ingredient_price_history (ingredient_id, price_per_unit) VALUES (?, ?)', [ingredientId, finalPrice]);
        }

        const created = await dbGet('SELECT * FROM ingredients WHERE id = ?', [ingredientId]);
        res.json(await resolveIngredientRow(created));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update ingredient
router.put('/:id', async (req, res) => {
    try {
        const ingredientId = req.params.id;
        const name = (req.body.name || '').trim();
        const unit = (req.body.unit || '').trim();
        const category = (req.body.category || '').trim() || null;
        const { price_per_unit, supplier_id, source_recipe_id, yield_quantity } = req.body;
        const isBasedProduct = Boolean(source_recipe_id);

        const validationError = validateIngredientInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        if (isBasedProduct) {
            if (Number(source_recipe_id) === Number(ingredientId)) {
                return res.status(400).json({ error: 'Bahan tidak bisa dijadikan based product dari dirinya sendiri' });
            }
            const sourceRecipe = await dbGet('SELECT id FROM recipes WHERE id = ?', [source_recipe_id]);
            if (!sourceRecipe) return res.status(400).json({ error: 'Resep sumber tidak ditemukan' });
        }

        const existingName = await dbGet('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?) AND id != ?', [name, ingredientId]);
        if (existingName) return res.status(400).json({ error: 'Bahan dengan nama ini sudah ada' });

        const current = await dbGet('SELECT price_per_unit FROM ingredients WHERE id = ?', [ingredientId]);
        if (!current) return res.status(404).json({ error: 'Bahan tidak ditemukan' });

        const finalPrice = isBasedProduct ? 0 : price_per_unit;
        const priceChanged = !isBasedProduct && Number(current.price_per_unit) !== Number(finalPrice);

        const result = await dbRun(
            'UPDATE ingredients SET name=?, unit=?, price_per_unit=?, supplier_id=?, category=?, source_recipe_id=?, yield_quantity=?, updated_at=CURRENT_TIMESTAMP WHERE id=?',
            [name, unit, finalPrice, supplier_id || null, category, isBasedProduct ? source_recipe_id : null, isBasedProduct ? yield_quantity : null, ingredientId]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Bahan tidak ditemukan' });

        if (priceChanged) {
            db.run('INSERT INTO ingredient_price_history (ingredient_id, price_per_unit) VALUES (?, ?)', [ingredientId, finalPrice]);
        }

        const updated = await dbGet('SELECT * FROM ingredients WHERE id = ?', [ingredientId]);
        res.json(await resolveIngredientRow(updated));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
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

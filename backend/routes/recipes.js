const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isNonEmptyString, isPositiveNumber, isPositiveInteger } = require('../utils/validate');
const { convertQuantity } = require('../utils/unitConversion');
const { calculateRecipeCost, DEFAULT_TARGET_FOOD_COST_PERCENT } = require('../utils/recipeCalc');
const { requireAdmin } = require('../middleware/auth');
const { resolveIngredientRows, wouldCreateCycle } = require('../utils/ingredientCost');

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

// Cek apakah sebuah nama kategori resep ditandai sebagai "based product" (lihat backend/routes/categories.js)
async function isBasedProductCategory(categoryName) {
    if (!categoryName) return false;
    const row = await dbGet('SELECT is_based_product_category FROM recipe_categories WHERE name = ?', [categoryName]);
    return Boolean(row && row.is_based_product_category);
}

// Cek dulu (sebelum resep dibuat/diupdate) apakah nama resep bentrok dengan bahan baku lain
// yang bukan hasil auto-sync resep ini sendiri. Dipanggil sebelum tulis apapun ke tabel recipes,
// supaya kalau gagal, tidak ada state resep yang sudah kepalang berubah tanpa bahan olahannya.
async function findBasedProductNameClash(recipeId, recipeName) {
    const linked = await dbGet('SELECT id FROM ingredients WHERE source_recipe_id = ?', [recipeId]);
    const clash = linked
        ? await dbGet('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?) AND id != ?', [recipeName, linked.id])
        : await dbGet('SELECT id FROM ingredients WHERE LOWER(name) = LOWER(?)', [recipeName]);
    return Boolean(clash);
}

// Buat/sinkronkan otomatis bahan baku "based product" dari sebuah resep yang berkategori based product.
// Dipanggil setiap kali resep berkategori based product dibuat/diupdate, supaya nama & yield-nya
// di daftar Bahan Baku selalu ikut nama & yield resep sumbernya. Asumsikan findBasedProductNameClash
// sudah dicek lebih dulu.
async function syncBasedProductIngredient(recipeId, recipeName, yieldQuantity, yieldUnit) {
    const existing = await dbGet('SELECT id FROM ingredients WHERE source_recipe_id = ?', [recipeId]);
    if (existing) {
        await dbRun(
            'UPDATE ingredients SET name = ?, unit = ?, yield_quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [recipeName, yieldUnit, yieldQuantity, existing.id]
        );
    } else {
        await dbRun(
            'INSERT INTO ingredients (name, unit, price_per_unit, source_recipe_id, yield_quantity) VALUES (?, ?, 0, ?, ?)',
            [recipeName, yieldUnit, recipeId, yieldQuantity]
        );
    }
}

// GET recipes - mendukung search, filter kategori, & pagination lewat query params.
// Tanpa query params sama sekali: kembalikan array penuh (dipakai dropdown).
router.get('/', (req, res) => {
    const { search, category, page, limit } = req.query;

    if (!search && !category && !page && !limit) {
        db.all('SELECT * FROM recipes ORDER BY name COLLATE NOCASE', [], (err, rows) => {
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
    if (category) {
        conditions.push('category = ?');
        params.push(category);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const pageNum = Math.max(parseInt(page) || 1, 1);
    const limitNum = Math.max(parseInt(limit) || 10, 1);
    const offset = (pageNum - 1) * limitNum;

    db.get(`SELECT COUNT(*) as total FROM recipes ${whereClause}`, params, (err, countRow) => {
        if (err) return res.status(500).json({ error: err.message });

        db.all(
            `SELECT * FROM recipes ${whereClause} ORDER BY name COLLATE NOCASE LIMIT ? OFFSET ?`,
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

// GET detail recipe + kalkulasi HPP (dengan konversi satuan & resolusi harga based product)
router.get('/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;

        const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [recipeId]);
        if (!recipe) return res.status(404).json({ error: 'Recipe not found' });

        const rawIngredients = await dbAll(
            `SELECT ri.id as recipe_ingredient_id, ri.ingredient_id, ri.quantity_used, ri.unit as used_unit,
                    i.name, i.unit, i.price_per_unit, i.source_recipe_id, i.yield_quantity
             FROM recipe_ingredients ri
             JOIN ingredients i ON ri.ingredient_id = i.id
             WHERE ri.recipe_id = ?`,
            [recipeId]
        );
        const ingredients = await resolveIngredientRows(rawIngredients);

        const calc = calculateRecipeCost(recipe, ingredients);

        res.json({
            ...recipe,
            target_food_cost_percent: calc.target_food_cost_percent,
            ingredients,
            hpp_total: calc.hpp_total,
            hpp_per_portion: calc.hpp_per_portion,
            food_cost_percentage: calc.food_cost_percentage !== null ? calc.food_cost_percentage.toFixed(2) : null,
            over_target: calc.over_target
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

function validateRecipeInput(body) {
    const name = (body.name || '').trim();
    const { selling_price, portion_yield, target_food_cost_percent } = body;

    if (!isNonEmptyString(name)) return 'Nama resep tidak boleh kosong';
    if (!isPositiveNumber(selling_price)) return 'Harga jual harus berupa angka lebih dari 0';
    if (portion_yield !== undefined && portion_yield !== null && portion_yield !== '' && !isPositiveInteger(Number(portion_yield))) {
        return 'Jumlah porsi harus berupa angka bulat lebih dari 0';
    }
    if (target_food_cost_percent !== undefined && target_food_cost_percent !== null && target_food_cost_percent !== '' && !isPositiveNumber(target_food_cost_percent)) {
        return 'Target food cost % harus berupa angka lebih dari 0';
    }
    return null;
}

// POST buat recipe baru
router.post('/', async (req, res) => {
    try {
        const name = (req.body.name || '').trim();
        const category = (req.body.category || '').trim() || null;
        const { selling_price, portion_yield, target_food_cost_percent, yield_quantity, yield_unit } = req.body;
        const targetPercent = target_food_cost_percent || DEFAULT_TARGET_FOOD_COST_PERCENT;

        const validationError = validateRecipeInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const isBasedProduct = await isBasedProductCategory(category);
        if (isBasedProduct) {
            if (!isPositiveNumber(yield_quantity)) return res.status(400).json({ error: 'Jumlah hasil (yield) harus berupa angka lebih dari 0' });
            if (!isNonEmptyString((yield_unit || '').trim())) return res.status(400).json({ error: 'Satuan hasil (yield) tidak boleh kosong' });
            if (await findBasedProductNameClash(null, name)) {
                return res.status(400).json({ error: `Tidak bisa membuat bahan olahan otomatis karena sudah ada bahan baku dengan nama "${name}"` });
            }
        }

        const existing = await dbGet('SELECT id FROM recipes WHERE LOWER(name) = LOWER(?)', [name]);
        if (existing) return res.status(400).json({ error: 'Resep dengan nama ini sudah ada' });

        const finalYieldQuantity = isBasedProduct ? yield_quantity : null;
        const finalYieldUnit = isBasedProduct ? (yield_unit || '').trim() : null;

        const result = await dbRun(
            'INSERT INTO recipes (name, selling_price, portion_yield, target_food_cost_percent, category, yield_quantity, yield_unit) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [name, selling_price, portion_yield || 1, targetPercent, category, finalYieldQuantity, finalYieldUnit]
        );

        if (isBasedProduct) {
            await syncBasedProductIngredient(result.lastID, name, finalYieldQuantity, finalYieldUnit);
        }

        res.json({
            id: result.lastID, name, selling_price, portion_yield: portion_yield || 1,
            target_food_cost_percent: targetPercent, category, yield_quantity: finalYieldQuantity, yield_unit: finalYieldUnit
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update recipe
router.put('/:id', async (req, res) => {
    try {
        const recipeId = req.params.id;
        const name = (req.body.name || '').trim();
        const category = (req.body.category || '').trim() || null;
        const { selling_price, portion_yield, target_food_cost_percent, yield_quantity, yield_unit } = req.body;
        const targetPercent = target_food_cost_percent || DEFAULT_TARGET_FOOD_COST_PERCENT;

        const validationError = validateRecipeInput(req.body);
        if (validationError) return res.status(400).json({ error: validationError });

        const isBasedProduct = await isBasedProductCategory(category);
        if (isBasedProduct) {
            if (!isPositiveNumber(yield_quantity)) return res.status(400).json({ error: 'Jumlah hasil (yield) harus berupa angka lebih dari 0' });
            if (!isNonEmptyString((yield_unit || '').trim())) return res.status(400).json({ error: 'Satuan hasil (yield) tidak boleh kosong' });
            if (await findBasedProductNameClash(recipeId, name)) {
                return res.status(400).json({ error: `Tidak bisa membuat bahan olahan otomatis karena sudah ada bahan baku dengan nama "${name}"` });
            }
        }

        const existing = await dbGet('SELECT id FROM recipes WHERE LOWER(name) = LOWER(?) AND id != ?', [name, recipeId]);
        if (existing) return res.status(400).json({ error: 'Resep dengan nama ini sudah ada' });

        const finalYieldQuantity = isBasedProduct ? yield_quantity : null;
        const finalYieldUnit = isBasedProduct ? (yield_unit || '').trim() : null;

        const result = await dbRun(
            'UPDATE recipes SET name=?, selling_price=?, portion_yield=?, target_food_cost_percent=?, category=?, yield_quantity=?, yield_unit=? WHERE id=?',
            [name, selling_price, portion_yield || 1, targetPercent, category, finalYieldQuantity, finalYieldUnit, recipeId]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Recipe tidak ditemukan' });

        if (isBasedProduct) {
            await syncBasedProductIngredient(recipeId, name, finalYieldQuantity, finalYieldUnit);
        }

        res.json({
            id: Number(recipeId), name, selling_price, portion_yield: portion_yield || 1,
            target_food_cost_percent: targetPercent, category, yield_quantity: finalYieldQuantity, yield_unit: finalYieldUnit
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST tambah bahan ke recipe (dengan satuan pemakaian, boleh beda dari satuan beli bahan selama masih sekeluarga)
router.post('/:id/ingredients', async (req, res) => {
    try {
        const { ingredient_id, quantity_used } = req.body;
        const requestedUnit = (req.body.unit || '').trim();
        const recipeId = req.params.id;

        if (!ingredient_id) {
            return res.status(400).json({ error: 'Bahan harus dipilih' });
        }
        if (!isPositiveNumber(quantity_used)) {
            return res.status(400).json({ error: 'Jumlah dipakai harus berupa angka lebih dari 0' });
        }

        const ingredient = await dbGet('SELECT unit, source_recipe_id FROM ingredients WHERE id = ?', [ingredient_id]);
        if (!ingredient) return res.status(400).json({ error: 'Bahan tidak ditemukan' });

        if (await wouldCreateCycle(recipeId, ingredient)) {
            return res.status(400).json({ error: 'Tidak bisa menambah bahan ini karena akan membuat referensi melingkar antar resep' });
        }

        const finalUnit = requestedUnit || ingredient.unit;
        if (finalUnit !== ingredient.unit && convertQuantity(1, finalUnit, ingredient.unit) === null) {
            return res.status(400).json({ error: `Satuan "${finalUnit}" tidak bisa dikonversi ke satuan bahan (${ingredient.unit})` });
        }

        db.run(
            'INSERT INTO recipe_ingredients (recipe_id, ingredient_id, quantity_used, unit) VALUES (?, ?, ?, ?)',
            [recipeId, ingredient_id, quantity_used, finalUnit],
            function (err) {
                if (err) return res.status(500).json({ error: err.message });
                res.json({ id: this.lastID, recipe_id: recipeId, ingredient_id, quantity_used, unit: finalUnit });
            }
        );
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT ubah jumlah/satuan 1 baris bahan yang sudah ada di resep
router.put('/:recipeId/ingredients/:ingredientRowId', (req, res) => {
    const { recipeId, ingredientRowId } = req.params;
    const { quantity_used } = req.body;
    const requestedUnit = (req.body.unit || '').trim();

    if (!isPositiveNumber(quantity_used)) {
        return res.status(400).json({ error: 'Jumlah dipakai harus berupa angka lebih dari 0' });
    }

    db.get(
        'SELECT ri.ingredient_id, i.unit FROM recipe_ingredients ri JOIN ingredients i ON ri.ingredient_id = i.id WHERE ri.id = ? AND ri.recipe_id = ?',
        [ingredientRowId, recipeId],
        (err, row) => {
            if (err) return res.status(500).json({ error: err.message });
            if (!row) return res.status(404).json({ error: 'Data bahan pada resep tidak ditemukan' });

            const finalUnit = requestedUnit || row.unit;
            if (finalUnit !== row.unit && convertQuantity(1, finalUnit, row.unit) === null) {
                return res.status(400).json({ error: `Satuan "${finalUnit}" tidak bisa dikonversi ke satuan bahan (${row.unit})` });
            }

            db.run(
                'UPDATE recipe_ingredients SET quantity_used = ?, unit = ? WHERE id = ? AND recipe_id = ?',
                [quantity_used, finalUnit, ingredientRowId, recipeId],
                function (err) {
                    if (err) return res.status(500).json({ error: err.message });
                    if (this.changes === 0) return res.status(404).json({ error: 'Data bahan pada resep tidak ditemukan' });
                    res.json({ id: Number(ingredientRowId), recipe_id: recipeId, quantity_used, unit: finalUnit });
                }
            );
        }
    );
});

// DELETE recipe (beserta semua relasi ingredient-nya).
// Kalau resep ini adalah based product (punya bahan baku otomatis), bahan itu ikut dihapus,
// kecuali masih dipakai di resep lain -- dalam hal itu penghapusan resep diblokir dulu.
router.delete('/:id', requireAdmin, async (req, res) => {
    try {
        const recipeId = req.params.id;

        const linkedIngredient = await dbGet('SELECT id, name FROM ingredients WHERE source_recipe_id = ?', [recipeId]);
        if (linkedIngredient) {
            const usage = await dbGet('SELECT COUNT(*) as count FROM recipe_ingredients WHERE ingredient_id = ?', [linkedIngredient.id]);
            if (usage.count > 0) {
                return res.status(400).json({
                    error: `Tidak bisa menghapus resep ini karena hasil olahannya ("${linkedIngredient.name}") masih dipakai sebagai bahan di ${usage.count} resep lain.`
                });
            }
        }

        await dbRun('DELETE FROM recipe_ingredients WHERE recipe_id = ?', [recipeId]);
        if (linkedIngredient) {
            await dbRun('DELETE FROM ingredients WHERE id = ?', [linkedIngredient.id]);
        }

        const result = await dbRun('DELETE FROM recipes WHERE id = ?', [recipeId]);
        if (result.changes === 0) {
            return res.status(404).json({ error: 'Recipe tidak ditemukan' });
        }

        res.json({ message: 'Recipe dan semua bahan terkait berhasil dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// DELETE hapus 1 bahan dari recipe tertentu
router.delete('/:recipeId/ingredients/:ingredientRowId', requireAdmin, (req, res) => {
    const { recipeId, ingredientRowId } = req.params;

    db.run(
        'DELETE FROM recipe_ingredients WHERE id = ? AND recipe_id = ?',
        [ingredientRowId, recipeId],
        function (err) {
            if (err) return res.status(500).json({ error: err.message });

            if (this.changes === 0) {
                return res.status(404).json({ error: 'Data bahan pada resep tidak ditemukan' });
            }

            res.json({ message: 'Bahan berhasil dihapus dari resep' });
        }
    );
});


module.exports = router;

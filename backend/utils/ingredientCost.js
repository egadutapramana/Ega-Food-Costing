const db = require('../database/db');
const { convertQuantity } = require('./unitConversion');

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

const SOURCE_RECIPE_INGREDIENTS_SQL = `
    SELECT ri.quantity_used, ri.unit as used_unit, i.id as ingredient_id, i.name, i.unit, i.price_per_unit, i.source_recipe_id, i.yield_quantity
    FROM recipe_ingredients ri
    JOIN ingredients i ON ri.ingredient_id = i.id
    WHERE ri.recipe_id = ?
`;

// Hitung harga per satuan efektif untuk 1 baris bahan, menelusuri rantai "based product" berlapis kalau ada.
// visitedRecipeIds: set id resep yang sedang ditelusuri di rantai ini, untuk deteksi referensi melingkar.
async function resolveIngredientUnitPrice(ingredientRow, visitedRecipeIds = new Set()) {
    if (!ingredientRow.source_recipe_id) {
        return Number(ingredientRow.price_per_unit) || 0;
    }

    if (visitedRecipeIds.has(ingredientRow.source_recipe_id)) {
        // Referensi melingkar - jangan sampai infinite loop, anggap saja biayanya 0 untuk baris ini.
        return 0;
    }
    const nextVisited = new Set(visitedRecipeIds);
    nextVisited.add(ingredientRow.source_recipe_id);

    const recipe = await dbGet('SELECT * FROM recipes WHERE id = ?', [ingredientRow.source_recipe_id]);
    if (!recipe) return 0; // resep sumber sudah dihapus

    const rows = await dbAll(SOURCE_RECIPE_INGREDIENTS_SQL, [ingredientRow.source_recipe_id]);

    let total = 0;
    for (const row of rows) {
        const unitPrice = await resolveIngredientUnitPrice(row, nextVisited);
        const usedUnit = row.used_unit || row.unit;
        const converted = convertQuantity(row.quantity_used, usedUnit, row.unit);
        const effectiveQty = converted !== null ? converted : row.quantity_used;
        total += effectiveQty * unitPrice;
    }

    const yieldQty = Number(ingredientRow.yield_quantity) > 0 ? Number(ingredientRow.yield_quantity) : 1;
    return total / yieldQty;
}

// Terapkan resolveIngredientUnitPrice ke satu ingredient (row dari tabel ingredients langsung)
async function resolveIngredientRow(ingredient) {
    if (!ingredient || !ingredient.source_recipe_id) return ingredient;
    const price = await resolveIngredientUnitPrice(ingredient);
    return { ...ingredient, price_per_unit: price };
}

// Terapkan resolveIngredientUnitPrice ke banyak ingredient sekaligus (dipakai untuk list/dropdown)
async function resolveIngredientRows(ingredients) {
    const resolved = [];
    for (const ing of ingredients) {
        resolved.push(await resolveIngredientRow(ing));
    }
    return resolved;
}

// Cek apakah menambahkan `candidateIngredient` (yang mungkin based-product) ke `targetRecipeId`
// akan membuat referensi melingkar (misal resep A pakai bahan dari resep B, B pakai bahan dari A).
async function wouldCreateCycle(targetRecipeId, candidateIngredient) {
    if (!candidateIngredient.source_recipe_id) return false;

    const visited = new Set();
    const stack = [candidateIngredient.source_recipe_id];

    while (stack.length > 0) {
        const currentRecipeId = stack.pop();
        if (Number(currentRecipeId) === Number(targetRecipeId)) return true;
        if (visited.has(currentRecipeId)) continue;
        visited.add(currentRecipeId);

        const rows = await dbAll(
            `SELECT i.source_recipe_id FROM recipe_ingredients ri
             JOIN ingredients i ON ri.ingredient_id = i.id
             WHERE ri.recipe_id = ? AND i.source_recipe_id IS NOT NULL`,
            [currentRecipeId]
        );
        rows.forEach((r) => stack.push(r.source_recipe_id));
    }

    return false;
}

module.exports = { resolveIngredientUnitPrice, resolveIngredientRow, resolveIngredientRows, wouldCreateCycle };

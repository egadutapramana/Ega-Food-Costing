const express = require('express');
const router = express.Router();
const db = require('../database/db');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { calculateRecipeCost } = require('../utils/recipeCalc');
const { resolveIngredientRows } = require('../utils/ingredientCost');

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

const RECIPE_INGREDIENTS_SQL = `
    SELECT ri.quantity_used, ri.unit as used_unit, i.name, i.unit, i.price_per_unit, i.source_recipe_id, i.yield_quantity
    FROM recipe_ingredients ri
    JOIN ingredients i ON ri.ingredient_id = i.id
    WHERE ri.recipe_id = ?
`;

async function getAllRecipesWithCost() {
    const recipes = await dbAll('SELECT * FROM recipes ORDER BY name COLLATE NOCASE');
    const results = [];
    for (const recipe of recipes) {
        const rawIngredientRows = await dbAll(RECIPE_INGREDIENTS_SQL, [recipe.id]);
        const ingredientRows = await resolveIngredientRows(rawIngredientRows);
        const calc = calculateRecipeCost(recipe, ingredientRows);
        results.push({ ...recipe, ingredients: ingredientRows, ...calc });
    }
    return results;
}

// GET dashboard ringkasan
router.get('/dashboard', async (req, res) => {
    try {
        const recipesWithCost = await getAllRecipesWithCost();
        const ingredients = await dbAll('SELECT * FROM ingredients');
        const suppliers = await dbAll('SELECT * FROM suppliers');

        const validPercentRecipes = recipesWithCost.filter((r) => r.food_cost_percentage !== null);

        const toSummaryItem = (r) => ({
            id: r.id,
            name: r.name,
            food_cost_percentage: Number(r.food_cost_percentage.toFixed(2)),
            target_food_cost_percent: r.target_food_cost_percent
        });

        const mostProfitable = [...validPercentRecipes]
            .sort((a, b) => a.food_cost_percentage - b.food_cost_percentage)
            .slice(0, 5)
            .map(toSummaryItem);

        const leastProfitable = [...validPercentRecipes]
            .sort((a, b) => b.food_cost_percentage - a.food_cost_percentage)
            .slice(0, 5)
            .map(toSummaryItem);

        const overTargetRecipes = recipesWithCost.filter((r) => r.over_target).map(toSummaryItem);

        const mostExpensiveIngredients = [...ingredients]
            .sort((a, b) => b.price_per_unit - a.price_per_unit)
            .slice(0, 5)
            .map((i) => ({ id: i.id, name: i.name, price_per_unit: i.price_per_unit, unit: i.unit }));

        const avgFoodCostPercent = validPercentRecipes.length > 0
            ? Number((validPercentRecipes.reduce((sum, r) => sum + r.food_cost_percentage, 0) / validPercentRecipes.length).toFixed(2))
            : null;

        res.json({
            summary: {
                total_recipes: recipesWithCost.length,
                total_ingredients: ingredients.length,
                total_suppliers: suppliers.length,
                avg_food_cost_percentage: avgFoodCostPercent,
                recipes_over_target: overTargetRecipes.length
            },
            most_profitable_recipes: mostProfitable,
            least_profitable_recipes: leastProfitable,
            over_target_recipes: overTargetRecipes,
            most_expensive_ingredients: mostExpensiveIngredients
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export laporan HPP resep ke Excel
router.get('/recipes/export/excel', async (req, res) => {
    try {
        const recipesWithCost = await getAllRecipesWithCost();

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Laporan HPP Resep');

        sheet.columns = [
            { header: 'Nama Resep', key: 'name', width: 30 },
            { header: 'Kategori', key: 'category', width: 18 },
            { header: 'Harga Jual', key: 'selling_price', width: 15 },
            { header: 'Porsi', key: 'portion_yield', width: 10 },
            { header: 'HPP Total', key: 'hpp_total', width: 15 },
            { header: 'HPP per Porsi', key: 'hpp_per_portion', width: 15 },
            { header: 'Food Cost %', key: 'food_cost_percentage', width: 15 },
            { header: 'Target %', key: 'target_food_cost_percent', width: 12 },
            { header: 'Status', key: 'status', width: 18 }
        ];
        sheet.getRow(1).font = { bold: true };

        recipesWithCost.forEach((r) => {
            sheet.addRow({
                name: r.name,
                category: r.category || '-',
                selling_price: r.selling_price,
                portion_yield: r.portion_yield,
                hpp_total: Math.round(r.hpp_total),
                hpp_per_portion: Math.round(r.hpp_per_portion),
                food_cost_percentage: r.food_cost_percentage !== null ? Number(r.food_cost_percentage.toFixed(2)) : null,
                target_food_cost_percent: r.target_food_cost_percent,
                status: r.over_target ? 'Melebihi Target' : 'Aman'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="laporan-hpp-resep.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export daftar bahan baku ke Excel
router.get('/ingredients/export/excel', async (req, res) => {
    try {
        const ingredients = await dbAll('SELECT * FROM ingredients ORDER BY category, name COLLATE NOCASE');
        const suppliers = await dbAll('SELECT * FROM suppliers');
        const supplierMap = new Map(suppliers.map((s) => [s.id, s.name]));

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Daftar Bahan Baku');
        sheet.columns = [
            { header: 'Nama', key: 'name', width: 25 },
            { header: 'Kategori', key: 'category', width: 18 },
            { header: 'Satuan', key: 'unit', width: 10 },
            { header: 'Harga/Satuan', key: 'price_per_unit', width: 15 },
            { header: 'Supplier', key: 'supplier', width: 25 }
        ];
        sheet.getRow(1).font = { bold: true };

        ingredients.forEach((i) => {
            sheet.addRow({
                name: i.name,
                category: i.category || '-',
                unit: i.unit,
                price_per_unit: i.price_per_unit,
                supplier: supplierMap.get(i.supplier_id) || '-'
            });
        });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename="daftar-bahan-baku.xlsx"');
        await workbook.xlsx.write(res);
        res.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET export laporan HPP resep ke PDF
router.get('/recipes/export/pdf', async (req, res) => {
    try {
        const recipesWithCost = await getAllRecipesWithCost();

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', 'attachment; filename="laporan-hpp-resep.pdf"');

        const doc = new PDFDocument({ margin: 40, size: 'A4' });
        doc.pipe(res);

        doc.fontSize(18).fillColor('#000').text('Laporan HPP Resep', { align: 'center' });
        doc.moveDown(0.3);
        doc.fontSize(9).fillColor('#666').text(`Dicetak: ${new Date().toLocaleString('id-ID')}`, { align: 'center' });
        doc.moveDown(1.5);

        if (recipesWithCost.length === 0) {
            doc.fontSize(11).fillColor('#000').text('Belum ada resep.');
        }

        recipesWithCost.forEach((r, idx) => {
            if (idx > 0) doc.moveDown(0.8);

            doc.fontSize(13).fillColor('#2e7d32').text(r.name);
            doc.fontSize(10).fillColor('#000');
            doc.text(`Harga Jual: Rp${Number(r.selling_price).toLocaleString('id-ID')}  |  Porsi: ${r.portion_yield}`);
            doc.text(`HPP Total: Rp${Math.round(r.hpp_total).toLocaleString('id-ID')}  |  HPP/Porsi: Rp${Math.round(r.hpp_per_portion).toLocaleString('id-ID')}`);

            const percentText = r.food_cost_percentage !== null ? `${r.food_cost_percentage.toFixed(2)}%` : 'N/A';
            doc.fillColor(r.over_target ? '#c62828' : '#2e7d32')
                .text(`Food Cost: ${percentText}  (Target: ${r.target_food_cost_percent}%)${r.over_target ? '  [MELEBIHI TARGET]' : ''}`);
            doc.fillColor('#000');

            r.ingredients.forEach((ing) => {
                const usedUnit = ing.used_unit || ing.unit;
                doc.fontSize(9).text(`   - ${ing.name}: ${ing.quantity_used} ${usedUnit}`);
            });

            doc.moveTo(doc.x, doc.y + 4).lineTo(555, doc.y + 4).strokeColor('#ddd').stroke();
            doc.moveDown(0.3);
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

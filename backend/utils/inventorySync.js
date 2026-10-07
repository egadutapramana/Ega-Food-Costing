const db = require('../database/db');

// Samakan bahan baku dengan item Food Inventory (dipanggil setiap bahan baku ditambah/diedit).
// Item inventory dicocokkan lewat nama (tanpa beda huruf besar/kecil): kalau sudah ada, nama/kategori/
// satuan/harga diperbarui; kalau belum, dibuat baru dengan stok 0. Stok & riwayatnya tidak disentuh.
// Gagal sinkron tidak boleh menggagalkan simpan bahan baku, jadi error hanya dicatat di log.

function getAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)));
    });
}

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

async function syncIngredientToInventory(ingredient, previousName) {
    if (!ingredient || !ingredient.name) return;
    try {
        const price = Number(ingredient.price_per_unit) || 0;
        const category = ingredient.category || '';
        const match = await getAsync(
            'SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?)',
            [previousName || ingredient.name]
        );
        if (match) {
            // Jangan bentrok dengan item inventory lain yang sudah memakai nama baru
            const clash = await getAsync(
                'SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?) AND id != ?',
                [ingredient.name, match.id]
            );
            if (clash) return;
            await runAsync(
                'UPDATE inventory_items SET name = ?, category = ?, unit = ?, price_per_unit = ? WHERE id = ?',
                [ingredient.name, category, ingredient.unit, price, match.id]
            );
        } else {
            const exists = await getAsync('SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?)', [ingredient.name]);
            if (exists) return;
            await runAsync(
                'INSERT INTO inventory_items (name, category, unit, price_per_unit) VALUES (?, ?, ?, ?)',
                [ingredient.name, category, ingredient.unit, price]
            );
        }
    } catch (err) {
        console.error('Gagal menyamakan bahan baku ke Food Inventory:', err);
    }
}

module.exports = { syncIngredientToInventory };

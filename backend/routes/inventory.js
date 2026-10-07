const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { isNonEmptyString, isValidPrice } = require('../utils/validate');
const { requireAdmin } = require('../middleware/auth');

// Food Inventory: daftar item sendiri (terpisah dari bahan baku).
// Stok TIDAK disimpan di tabel item, tapi dihitung dari riwayat inventory_movements:
//   in      -> stok + quantity
//   out     -> stok - quantity
//   opname  -> stok = quantity (hasil hitung fisik); selisihnya disimpan di kolom difference

const MOVEMENT_TYPES = ['in', 'out', 'opname'];

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

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

const round = (n) => Math.round(Number(n) * 1000) / 1000;

function applyMovement(stock, m) {
    const qty = Number(m.quantity) || 0;
    if (m.type === 'in') return round(stock + qty);
    if (m.type === 'out') return round(stock - qty);
    return round(qty); // opname
}

// Hitung stok semua item (atau satu item), sekaligus stok setelah tiap movement.
async function computeStocks(itemId) {
    const rows = itemId
        ? await allAsync('SELECT * FROM inventory_movements WHERE item_id = ? ORDER BY id', [itemId])
        : await allAsync('SELECT * FROM inventory_movements ORDER BY id', []);
    const stock = {};
    const after = {};
    for (const m of rows) {
        stock[m.item_id] = applyMovement(stock[m.item_id] || 0, m);
        after[m.id] = stock[m.item_id];
    }
    return { stock, after };
}

function readItemBody(body) {
    return {
        name: (body.name || '').trim(),
        category: (body.category || '').trim(),
        unit: (body.unit || '').trim(),
        price: body.price_per_unit === '' || body.price_per_unit === undefined || body.price_per_unit === null ? 0 : body.price_per_unit
    };
}

function validateItem({ name, unit, price }) {
    if (!isNonEmptyString(name)) return 'Nama item tidak boleh kosong';
    if (!isNonEmptyString(unit)) return 'Satuan tidak boleh kosong';
    if (!isValidPrice(price)) return 'Harga per satuan harus angka 0 atau lebih';
    return null;
}

// GET semua item + stok & nilai stok saat ini
router.get('/items', async (req, res) => {
    try {
        const items = await allAsync('SELECT * FROM inventory_items ORDER BY name COLLATE NOCASE', []);
        const { stock } = await computeStocks();
        res.json(items.map((it) => {
            const s = stock[it.id] || 0;
            return { ...it, stock: s, value: round(s * Number(it.price_per_unit || 0)) };
        }));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST item baru (opsional dengan stok awal)
router.post('/items', async (req, res) => {
    const data = readItemBody(req.body);
    const error = validateItem(data);
    if (error) return res.status(400).json({ error });
    const opening = Number(req.body.opening_stock) || 0;
    if (opening < 0) return res.status(400).json({ error: 'Stok awal tidak boleh negatif' });

    try {
        const existing = await getAsync('SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?)', [data.name]);
        if (existing) return res.status(400).json({ error: 'Item dengan nama ini sudah ada' });

        const result = await runAsync(
            'INSERT INTO inventory_items (name, category, unit, price_per_unit) VALUES (?, ?, ?, ?)',
            [data.name, data.category, data.unit, Number(data.price)]
        );
        if (opening > 0) {
            await runAsync(
                'INSERT INTO inventory_movements (item_id, type, quantity, note, created_by) VALUES (?, ?, ?, ?, ?)',
                [result.lastID, 'in', opening, 'Stok awal', req.user.username]
            );
        }
        res.json({ id: result.lastID });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST salin semua bahan baku ke daftar inventory (admin only).
// Nama, kategori, satuan & harga ikut disalin, stok mulai dari 0; nama yang sudah ada di inventory dilewati.
router.post('/items/import-from-ingredients', requireAdmin, async (req, res) => {
    try {
        const before = await getAsync('SELECT COUNT(*) AS count FROM inventory_items', []);
        await runAsync(
            `INSERT INTO inventory_items (name, category, unit, price_per_unit)
             SELECT i.name, i.category, i.unit, i.price_per_unit FROM ingredients i
             WHERE i.id IN (SELECT MIN(id) FROM ingredients GROUP BY LOWER(name))
               AND NOT EXISTS (SELECT 1 FROM inventory_items x WHERE LOWER(x.name) = LOWER(i.name))`,
            []
        );
        const after = await getAsync('SELECT COUNT(*) AS count FROM inventory_items', []);
        const total = await getAsync('SELECT COUNT(*) AS count FROM ingredients', []);
        const added = Number(after.count) - Number(before.count);
        res.json({ added, skipped: Number(total.count) - added });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PUT update item (nama, kategori, satuan, harga) — stok diubah lewat movement, bukan di sini
router.put('/items/:id', async (req, res) => {
    const data = readItemBody(req.body);
    const error = validateItem(data);
    if (error) return res.status(400).json({ error });

    try {
        const existing = await getAsync('SELECT id FROM inventory_items WHERE LOWER(name) = LOWER(?) AND id != ?', [data.name, req.params.id]);
        if (existing) return res.status(400).json({ error: 'Item dengan nama ini sudah ada' });

        const result = await runAsync(
            'UPDATE inventory_items SET name = ?, category = ?, unit = ?, price_per_unit = ? WHERE id = ?',
            [data.name, data.category, data.unit, Number(data.price), req.params.id]
        );
        if (result.changes === 0) return res.status(404).json({ error: 'Item tidak ditemukan' });
        res.json({ id: Number(req.params.id) });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE item beserta seluruh riwayatnya (admin only)
router.delete('/items/:id', requireAdmin, async (req, res) => {
    try {
        await runAsync('DELETE FROM inventory_movements WHERE item_id = ?', [req.params.id]);
        const result = await runAsync('DELETE FROM inventory_items WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Item tidak ditemukan' });
        res.json({ message: 'Item deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET riwayat movement terbaru (opsional ?item_id=, ?type=, ?limit=)
router.get('/movements', async (req, res) => {
    try {
        const itemId = req.query.item_id ? Number(req.query.item_id) : null;
        const type = MOVEMENT_TYPES.includes(req.query.type) ? req.query.type : null;
        const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);

        const where = [];
        const params = [];
        if (itemId) { where.push('m.item_id = ?'); params.push(itemId); }
        if (type) { where.push('m.type = ?'); params.push(type); }
        params.push(limit);

        const rows = await allAsync(
            `SELECT m.*, i.name AS item_name, i.unit AS item_unit
             FROM inventory_movements m JOIN inventory_items i ON i.id = m.item_id
             ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
             ORDER BY m.id DESC LIMIT ?`,
            params
        );
        const { after } = await computeStocks(itemId);
        res.json(rows.map((m) => ({ ...m, stock_after: after[m.id] })));
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// POST movement baru: stok masuk, stok keluar, atau stock opname
router.post('/movements', async (req, res) => {
    const itemId = Number(req.body.item_id);
    const type = req.body.type;
    const quantity = Number(req.body.quantity);
    const note = (req.body.note || '').trim();

    if (!itemId) return res.status(400).json({ error: 'Pilih item terlebih dahulu' });
    if (!MOVEMENT_TYPES.includes(type)) return res.status(400).json({ error: 'Jenis transaksi tidak valid' });
    if (req.body.quantity === '' || req.body.quantity === undefined || isNaN(quantity)) {
        return res.status(400).json({ error: 'Jumlah harus diisi dengan angka' });
    }
    if (type === 'opname' ? quantity < 0 : quantity <= 0) {
        return res.status(400).json({ error: type === 'opname' ? 'Hasil hitung fisik tidak boleh negatif' : 'Jumlah harus lebih dari 0' });
    }

    try {
        const item = await getAsync('SELECT * FROM inventory_items WHERE id = ?', [itemId]);
        if (!item) return res.status(404).json({ error: 'Item tidak ditemukan' });

        const { stock } = await computeStocks(itemId);
        const current = stock[itemId] || 0;
        if (type === 'out' && quantity > current) {
            return res.status(400).json({ error: `Stok ${item.name} tidak cukup (sisa ${current} ${item.unit})` });
        }
        const difference = type === 'opname' ? round(quantity - current) : null;

        const result = await runAsync(
            'INSERT INTO inventory_movements (item_id, type, quantity, difference, note, created_by) VALUES (?, ?, ?, ?, ?, ?)',
            [itemId, type, quantity, difference, note, req.user.username]
        );
        const newStock = applyMovement(current, { type, quantity });
        res.json({ id: result.lastID, stock: newStock, difference });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE satu movement (admin only) — stok otomatis dihitung ulang
router.delete('/movements/:id', requireAdmin, async (req, res) => {
    try {
        const result = await runAsync('DELETE FROM inventory_movements WHERE id = ?', [req.params.id]);
        if (result.changes === 0) return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
        res.json({ message: 'Movement deleted' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

require('dotenv').config();
const path = require('path');

// Kalau DATABASE_URL diset (biasanya di produksi, lewat hosting seperti Neon/Supabase/Railway),
// pakai PostgreSQL. Kalau tidak, tetap pakai SQLite lokal seperti biasa (untuk development).
const DATABASE_URL = process.env.DATABASE_URL;
const isPg = Boolean(DATABASE_URL);

let db;

function runAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

function allAsync(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
    });
}

async function addColumnIfMissing(table, column, definition) {
    try {
        let exists;
        if (isPg) {
            const rows = await allAsync(
                'SELECT column_name FROM information_schema.columns WHERE table_name = ? AND column_name = ?',
                [table, column]
            );
            exists = rows.length > 0;
        } else {
            const columns = await allAsync(`PRAGMA table_info(${table})`, []);
            exists = columns.some((c) => c.name === column);
        }
        if (!exists) {
            await runAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
        }
    } catch (err) {
        console.error(`Gagal memeriksa/menambah kolom ${column} ke ${table}`, err);
    }
}

async function seedCategoriesIfEmpty(table, defaults) {
    try {
        const rows = await allAsync(`SELECT COUNT(*) as count FROM ${table}`, []);
        const count = Number(rows[0].count);
        if (count === 0) {
            // Pakai insert yang aman terhadap duplikat (bukan cuma cek count di awal), supaya kalau ada
            // proses lain yang kebetulan mengisi bersamaan, tidak ada kategori default yang gagal ke-skip.
            const insertSql = isPg
                ? `INSERT INTO ${table} (name) VALUES (?) ON CONFLICT (name) DO NOTHING`
                : `INSERT OR IGNORE INTO ${table} (name) VALUES (?)`;
            for (const name of defaults) {
                try {
                    await runAsync(insertSql, [name]);
                } catch (err) {
                    console.error(`Gagal menambah kategori default "${name}" ke ${table}`, err);
                }
            }
        }
    } catch (err) {
        console.error(`Gagal mengisi kategori default untuk ${table}`, err);
    }
}

const SQLITE_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS suppliers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        contact TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        price_per_unit REAL NOT NULL,
        supplier_id INTEGER,
        category TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
    )`,
    `CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS ingredient_price_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ingredient_id INTEGER NOT NULL,
        price_per_unit REAL NOT NULL,
        changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    )`,
    `CREATE TABLE IF NOT EXISTS recipes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        selling_price REAL NOT NULL,
        portion_yield INTEGER DEFAULT 1,
        target_food_cost_percent REAL DEFAULT 30,
        category TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        recipe_id INTEGER,
        ingredient_id INTEGER,
        quantity_used REAL NOT NULL,
        unit TEXT,
        FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
        FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
    )`,
    `CREATE TABLE IF NOT EXISTS ingredient_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE
    )`
];

const PG_SCHEMA = [
    `CREATE TABLE IF NOT EXISTS suppliers (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        contact TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ingredients (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        unit TEXT NOT NULL,
        price_per_unit REAL NOT NULL,
        supplier_id INTEGER REFERENCES suppliers(id),
        category TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'staff',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS ingredient_price_history (
        id SERIAL PRIMARY KEY,
        ingredient_id INTEGER NOT NULL REFERENCES ingredients(id) ON DELETE CASCADE,
        price_per_unit REAL NOT NULL,
        changed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        selling_price REAL NOT NULL,
        portion_yield INTEGER DEFAULT 1,
        target_food_cost_percent REAL DEFAULT 30,
        category TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_ingredients (
        id SERIAL PRIMARY KEY,
        recipe_id INTEGER REFERENCES recipes(id) ON DELETE CASCADE,
        ingredient_id INTEGER REFERENCES ingredients(id),
        quantity_used REAL NOT NULL,
        unit TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS ingredient_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    )`,
    `CREATE TABLE IF NOT EXISTS recipe_categories (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL UNIQUE
    )`
];

async function initTables() {
    try {
        const schema = isPg ? PG_SCHEMA : SQLITE_SCHEMA;
        for (const sql of schema) {
            await runAsync(sql);
        }

        // Migrasi untuk database yang sudah ada sebelum kolom-kolom ini ditambahkan
        await addColumnIfMissing('ingredients', 'category', 'TEXT');
        await addColumnIfMissing('recipes', 'target_food_cost_percent', 'REAL DEFAULT 30');
        await addColumnIfMissing('recipe_ingredients', 'unit', 'TEXT');
        await addColumnIfMissing('recipes', 'category', 'TEXT');

        // Isi kategori default hanya kalau tabelnya masih kosong (misal: instalasi baru)
        await seedCategoriesIfEmpty('ingredient_categories', ['Sayur & Buah', 'Protein', 'Bumbu & Rempah', 'Karbohidrat', 'Dairy & Telur', 'Minuman', 'Lainnya']);
        await seedCategoriesIfEmpty('recipe_categories', ['Masakan Indonesia', 'Western', 'Asian', 'Minuman', 'Dessert', 'Appetizer', 'Lainnya']);

        // "Based product": bahan yang harganya diturunkan dari resep lain (misal Rica Rica Sauce, Mashed Potato)
        await addColumnIfMissing('ingredients', 'source_recipe_id', 'INTEGER');
        await addColumnIfMissing('ingredients', 'yield_quantity', 'REAL');

        console.log('Tables initialized');
    } catch (err) {
        console.error('Gagal inisialisasi tabel:', err);
    }
}

if (isPg) {
    const { createPgAdapter } = require('./pg-adapter');
    db = createPgAdapter(DATABASE_URL);
    console.log('Connected to PostgreSQL database');
    initTables();
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database(path.join(__dirname, 'foodcost.db'), (err) => {
        if (err) {
            console.error('Error opening database', err);
        } else {
            console.log('Connected to SQLite database');
            initTables();
        }
    });
}

module.exports = db;

require('dotenv').config();
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const db = new sqlite3.Database(path.join(__dirname, 'foodcost.db'), (err) => {
    if (err) {
        console.error('Error opening database', err);
    } else {
        console.log('Connected to SQLite database');
        initTables();
    }
});

function addColumnIfMissing(table, column, definition) {
    db.all(`PRAGMA table_info(${table})`, [], (err, columns) => {
        if (err) return console.error(`Gagal membaca skema tabel ${table}`, err);
        const exists = columns.some((c) => c.name === column);
        if (!exists) {
            db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`, (err) => {
                if (err) console.error(`Gagal menambah kolom ${column} ke ${table}`, err);
            });
        }
    });
}

function seedCategoriesIfEmpty(table, defaults) {
    db.get(`SELECT COUNT(*) as count FROM ${table}`, [], (err, row) => {
        if (err || !row) return;
        if (row.count === 0) {
            defaults.forEach((name) => {
                db.run(`INSERT INTO ${table} (name) VALUES (?)`, [name]);
            });
        }
    });
}

function initTables() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS suppliers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            contact TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            unit TEXT NOT NULL,
            price_per_unit REAL NOT NULL,
            supplier_id INTEGER,
            category TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (supplier_id) REFERENCES suppliers(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            role TEXT NOT NULL DEFAULT 'staff',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ingredient_price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ingredient_id INTEGER NOT NULL,
            price_per_unit REAL NOT NULL,
            changed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS recipes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            selling_price REAL NOT NULL,
            portion_yield INTEGER DEFAULT 1,
            target_food_cost_percent REAL DEFAULT 30,
            category TEXT
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS recipe_ingredients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            recipe_id INTEGER,
            ingredient_id INTEGER,
            quantity_used REAL NOT NULL,
            unit TEXT,
            FOREIGN KEY (recipe_id) REFERENCES recipes(id) ON DELETE CASCADE,
            FOREIGN KEY (ingredient_id) REFERENCES ingredients(id)
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS ingredient_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )`);

        db.run(`CREATE TABLE IF NOT EXISTS recipe_categories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )`);

        // Migrasi untuk database yang sudah ada sebelum kolom-kolom ini ditambahkan
        addColumnIfMissing('ingredients', 'category', 'TEXT');
        addColumnIfMissing('recipes', 'target_food_cost_percent', 'REAL DEFAULT 30');
        addColumnIfMissing('recipe_ingredients', 'unit', 'TEXT');
        addColumnIfMissing('recipes', 'category', 'TEXT');

        // Isi kategori default hanya kalau tabelnya masih kosong (misal: instalasi baru)
        seedCategoriesIfEmpty('ingredient_categories', ['Sayur & Buah', 'Protein', 'Bumbu & Rempah', 'Karbohidrat', 'Dairy & Telur', 'Minuman', 'Lainnya']);
        seedCategoriesIfEmpty('recipe_categories', ['Masakan Indonesia', 'Western', 'Asian', 'Minuman', 'Dessert', 'Appetizer', 'Lainnya']);

        console.log('Tables initialized');
    });
}

module.exports = db;

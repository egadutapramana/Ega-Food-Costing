// Adapter yang membuat PostgreSQL (lewat paket 'pg') bisa dipakai dengan API yang sama seperti
// sqlite3 (.get/.all/.run dengan callback gaya node-sqlite3). Tujuannya supaya semua route yang
// sudah ada (ingredients.js, recipes.js, dll) TIDAK perlu diubah sama sekali saat pindah dari
// SQLite (lokal) ke PostgreSQL (produksi) — db.js yang menentukan adapter mana yang dipakai.
const { Pool } = require('pg');

function convertSql(sql) {
    // Placeholder "?" (gaya sqlite3) -> "$1, $2, ..." (gaya pg)
    let i = 0;
    let converted = sql.replace(/\?/g, () => `$${++i}`);

    // LIKE -> ILIKE, supaya pencarian tetap case-insensitive seperti perilaku default SQLite
    converted = converted.replace(/\bLIKE\b/gi, 'ILIKE');

    // "kolom COLLATE NOCASE" (gaya sqlite3 untuk sort case-insensitive) -> "LOWER(kolom)"
    converted = converted.replace(/(\w+)\s+COLLATE NOCASE/gi, 'LOWER($1)');

    return converted;
}

function normalizeArgs(params, callback) {
    if (typeof params === 'function') {
        return { params: [], callback: params };
    }
    return { params: params || [], callback };
}

function createPgAdapter(connectionString) {
    const sslEnabled = process.env.DATABASE_SSL !== 'false';
    const pool = new Pool({
        connectionString,
        ssl: sslEnabled ? { rejectUnauthorized: false } : false
    });

    return {
        all(sql, paramsArg, callbackArg) {
            const { params, callback } = normalizeArgs(paramsArg, callbackArg);
            pool.query(convertSql(sql), params)
                .then((result) => callback(null, result.rows))
                .catch((err) => callback(err));
        },

        get(sql, paramsArg, callbackArg) {
            const { params, callback } = normalizeArgs(paramsArg, callbackArg);
            pool.query(convertSql(sql), params)
                .then((result) => callback(null, result.rows[0]))
                .catch((err) => callback(err));
        },

        run(sql, paramsArg, callbackArg) {
            const { params, callback } = normalizeArgs(paramsArg, callbackArg);
            let converted = convertSql(sql);
            const isInsert = /^\s*INSERT/i.test(converted) && !/RETURNING/i.test(converted);
            if (isInsert) converted += ' RETURNING id';

            pool.query(converted, params)
                .then((result) => {
                    const context = {
                        lastID: isInsert && result.rows[0] ? result.rows[0].id : undefined,
                        changes: result.rowCount
                    };
                    if (callback) callback.call(context, null);
                })
                .catch((err) => {
                    if (callback) callback.call({}, err);
                });
        }
    };
}

module.exports = { createPgAdapter };

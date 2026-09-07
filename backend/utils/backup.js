const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'database', 'foodcost.db');
const BACKUP_DIR = path.resolve(__dirname, '..', process.env.BACKUP_DIR || './database/backups');
const INTERVAL_HOURS = Number(process.env.BACKUP_INTERVAL_HOURS) || 24;
const RETENTION_COUNT = Number(process.env.BACKUP_RETENTION_COUNT) || 14;

function timestampForFilename() {
    return new Date().toISOString().replace(/[:.]/g, '-');
}

function runBackup() {
    if (!fs.existsSync(DB_PATH)) return null;
    if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const backupPath = path.join(BACKUP_DIR, `foodcost-${timestampForFilename()}.db`);
    fs.copyFileSync(DB_PATH, backupPath);
    pruneOldBackups();
    return backupPath;
}

function pruneOldBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const files = fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('foodcost-') && f.endsWith('.db'))
        .map((f) => ({ name: f, time: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
        .sort((a, b) => b.time - a.time);

    files.slice(RETENTION_COUNT).forEach((f) => {
        fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    });
}

function listBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return [];
    return fs.readdirSync(BACKUP_DIR)
        .filter((f) => f.startsWith('foodcost-') && f.endsWith('.db'))
        .map((f) => {
            const stat = fs.statSync(path.join(BACKUP_DIR, f));
            return { name: f, size: stat.size, created_at: stat.mtime };
        })
        .sort((a, b) => b.created_at - a.created_at);
}

function startBackupScheduler() {
    if (process.env.DATABASE_URL) {
        // Mode PostgreSQL (produksi): backup file lokal tidak relevan karena filesystem hosting
        // biasanya "ephemeral" (hilang tiap redeploy/restart). Andalkan backup otomatis bawaan
        // provider database (misal Neon), plus fitur "Export Semua Data" manual di aplikasi.
        console.log('Mode PostgreSQL terdeteksi: backup file lokal dilewati. Gunakan backup otomatis provider database (misal Neon) dan tombol "Export Semua Data" di aplikasi.');
        return;
    }

    runBackup(); // backup langsung sekali saat server start
    setInterval(runBackup, INTERVAL_HOURS * 60 * 60 * 1000);
    console.log(`Backup otomatis aktif: tiap ${INTERVAL_HOURS} jam, disimpan di ${BACKUP_DIR}`);
}

module.exports = { runBackup, listBackups, startBackupScheduler, BACKUP_DIR };

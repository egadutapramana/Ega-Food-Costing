const express = require('express');
const router = express.Router();
const db = require('../database/db');
const { hashPassword, verifyPassword, signToken } = require('../utils/auth');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isNonEmptyString } = require('../utils/validate');

const VALID_ROLES = ['admin', 'staff'];

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

// POST daftar akun baru.
// Kalau belum ada user sama sekali: bebas dipakai siapa saja, akun pertama otomatis jadi admin (bootstrap).
// Kalau sudah ada user: hanya admin yang boleh membuat akun baru.
router.post('/register', async (req, res, next) => {
    try {
        const userCount = await dbGet('SELECT COUNT(*) as count FROM users');
        if (userCount.count > 0) {
            return requireAuth(req, res, () => requireAdmin(req, res, () => handleRegister(req, res, false)));
        }
        return handleRegister(req, res, true);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

async function handleRegister(req, res, isBootstrap) {
    try {
        const username = (req.body.username || '').trim();
        const password = req.body.password || '';
        const requestedRole = (req.body.role || 'staff').trim();

        if (!isNonEmptyString(username)) return res.status(400).json({ error: 'Username tidak boleh kosong' });
        if (password.length < 6) return res.status(400).json({ error: 'Password minimal 6 karakter' });

        const role = isBootstrap ? 'admin' : requestedRole;
        if (!VALID_ROLES.includes(role)) return res.status(400).json({ error: 'Role tidak valid' });

        const existing = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        if (existing) return res.status(400).json({ error: 'Username sudah dipakai' });

        const passwordHash = await hashPassword(password);
        const result = await dbRun('INSERT INTO users (username, password_hash, role) VALUES (?, ?, ?)', [username, passwordHash, role]);

        res.json({ id: result.lastID, username, role });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
}

// POST login
router.post('/login', async (req, res) => {
    try {
        const username = (req.body.username || '').trim();
        const password = req.body.password || '';

        if (!isNonEmptyString(username) || !password) {
            return res.status(400).json({ error: 'Username dan password wajib diisi' });
        }

        const user = await dbGet('SELECT * FROM users WHERE LOWER(username) = LOWER(?)', [username]);
        if (!user) return res.status(401).json({ error: 'Username atau password salah' });

        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Username atau password salah' });

        const token = signToken(user);
        res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET info user yang sedang login
router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user });
});

// PUT ganti username dan/atau password akun sendiri. Wajib konfirmasi password saat ini.
router.put('/me', requireAuth, async (req, res) => {
    try {
        const currentPassword = req.body.current_password || '';
        const newUsername = (req.body.new_username || '').trim();
        const newPassword = req.body.new_password || '';

        if (!newUsername && !newPassword) {
            return res.status(400).json({ error: 'Tidak ada perubahan yang dikirim' });
        }
        if (!currentPassword) {
            return res.status(400).json({ error: 'Password saat ini wajib diisi untuk konfirmasi' });
        }
        if (newPassword && newPassword.length < 6) {
            return res.status(400).json({ error: 'Password baru minimal 6 karakter' });
        }

        const user = await dbGet('SELECT * FROM users WHERE id = ?', [req.user.id]);
        if (!user) return res.status(404).json({ error: 'User tidak ditemukan' });

        const validCurrent = await verifyPassword(currentPassword, user.password_hash);
        if (!validCurrent) return res.status(400).json({ error: 'Password saat ini salah' });

        if (newUsername) {
            const existing = await dbGet('SELECT id FROM users WHERE LOWER(username) = LOWER(?) AND id != ?', [newUsername, req.user.id]);
            if (existing) return res.status(400).json({ error: 'Username sudah dipakai' });
        }

        const finalUsername = newUsername || user.username;
        const finalPasswordHash = newPassword ? await hashPassword(newPassword) : user.password_hash;

        await dbRun('UPDATE users SET username = ?, password_hash = ? WHERE id = ?', [finalUsername, finalPasswordHash, req.user.id]);

        const updatedUser = { id: user.id, username: finalUsername, role: user.role };
        const token = signToken(updatedUser);
        res.json({ token, user: updatedUser });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET daftar semua user (admin only)
router.get('/users', requireAuth, requireAdmin, async (req, res) => {
    try {
        const users = await dbAll('SELECT id, username, role, created_at FROM users ORDER BY username COLLATE NOCASE');
        res.json(users);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE user (admin only, tidak bisa hapus diri sendiri atau admin terakhir)
router.delete('/users/:id', requireAuth, requireAdmin, async (req, res) => {
    try {
        const targetId = Number(req.params.id);

        if (targetId === req.user.id) {
            return res.status(400).json({ error: 'Tidak bisa menghapus akun sendiri' });
        }

        const target = await dbGet('SELECT * FROM users WHERE id = ?', [targetId]);
        if (!target) return res.status(404).json({ error: 'User tidak ditemukan' });

        if (target.role === 'admin') {
            const adminCount = await dbGet("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
            if (adminCount.count <= 1) {
                return res.status(400).json({ error: 'Tidak bisa menghapus admin terakhir' });
            }
        }

        await dbRun('DELETE FROM users WHERE id = ?', [targetId]);
        res.json({ message: 'User dihapus' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

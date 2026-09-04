const { verifyToken } = require('../utils/auth');

// Wajibkan login yang valid. Menyisipkan req.user = { id, username, role }.
function requireAuth(req, res, next) {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;

    if (!token) {
        return res.status(401).json({ error: 'Belum login' });
    }

    try {
        req.user = verifyToken(token);
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Sesi tidak valid atau sudah kedaluwarsa, silakan login ulang' });
    }
}

// Wajibkan role admin (dipakai setelah requireAuth). Staff akan ditolak dengan 403.
function requireAdmin(req, res, next) {
    if (!req.user || req.user.role !== 'admin') {
        return res.status(403).json({ error: 'Hanya admin yang boleh melakukan aksi ini' });
    }
    next();
}

module.exports = { requireAuth, requireAdmin };

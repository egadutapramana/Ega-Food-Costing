// Script darurat untuk reset password langsung lewat database, dipakai kalau semua akun admin
// terkunci (lupa password) dan tidak ada cara lain untuk login.
//
// HANYA bisa dijalankan oleh siapa pun yang punya akses ke file/server ini (tidak lewat internet/API),
// jadi aman selama server-nya sendiri aman.
//
// Cara pakai (dari folder backend/):
//   node scripts/reset-password.js --list
//   node scripts/reset-password.js <username> <password-baru>

require('dotenv').config();
const db = require('../database/db');
const { hashPassword } = require('../utils/auth');

const [, , arg1, arg2] = process.argv;

function listUsers() {
    db.all('SELECT username, role FROM users ORDER BY username COLLATE NOCASE', [], (err, rows) => {
        if (err) {
            console.error('Gagal membaca daftar user:', err.message);
            process.exit(1);
        }
        if (rows.length === 0) {
            console.log('Belum ada user sama sekali. Buka aplikasinya, akan muncul form "Daftar akun admin pertama".');
        } else {
            console.log('Daftar user:');
            rows.forEach((u) => console.log(`  - ${u.username} (${u.role})`));
        }
        process.exit(0);
    });
}

async function resetPassword(username, newPassword) {
    if (newPassword.length < 6) {
        console.error('Password baru minimal 6 karakter.');
        process.exit(1);
    }

    const passwordHash = await hashPassword(newPassword);
    db.run(
        'UPDATE users SET password_hash = ? WHERE LOWER(username) = LOWER(?)',
        [passwordHash, username],
        function (err) {
            if (err) {
                console.error('Gagal reset password:', err.message);
                process.exit(1);
            }
            if (this.changes === 0) {
                console.error(`User "${username}" tidak ditemukan. Jalankan "node scripts/reset-password.js --list" untuk lihat daftar user.`);
                process.exit(1);
            }
            console.log(`Password untuk user "${username}" berhasil direset. Silakan login dengan password baru.`);
            process.exit(0);
        }
    );
}

if (arg1 === '--list' || !arg1) {
    listUsers();
} else if (!arg2) {
    console.log('Pemakaian:');
    console.log('  node scripts/reset-password.js --list');
    console.log('  node scripts/reset-password.js <username> <password-baru>');
    process.exit(1);
} else {
    resetPassword(arg1, arg2);
}

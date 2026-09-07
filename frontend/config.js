// Alamat backend API. Otomatis pilih localhost kalau dibuka di komputer sendiri (lokal),
// atau backend production kalau dibuka lewat URL yang sudah di-deploy (misal Vercel).
// Jadi file ini tidak perlu diubah-ubah manual tiap pindah antara lokal dan production.
const isLocal = window.location.hostname === '' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocal
  ? 'http://localhost:3000/api'
  : 'https://ega-food-costing-production.up.railway.app/api';

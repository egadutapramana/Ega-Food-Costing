// Alamat backend API. Otomatis pilih localhost kalau dibuka di komputer sendiri (lokal),
// atau /api di alamat yang sama kalau dibuka lewat Vercel (backend berjalan sebagai serverless
// function di project Vercel yang sama, lihat api/index.js & vercel.json).
const isLocal = window.location.hostname === '' || window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const API_BASE_URL = isLocal
  ? 'http://localhost:3000/api'
  : '/api';

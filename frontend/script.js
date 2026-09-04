const API_URL = 'http://localhost:3000/api';

// ==========================
// AUTH: token, current user, dan wrapper fetch yang otomatis kirim Authorization header
// ==========================
let currentUser = null;

function getToken() {
  return localStorage.getItem('token');
}

function setSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
  currentUser = user;
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  currentUser = null;
}

async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}) };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) {
    clearSession();
    showLoginOverlay();
    throw new Error('Sesi berakhir, silakan login ulang');
  }
  return res;
}

// ==========================
// TOAST: pengganti showToast() untuk notifikasi non-blocking
// ==========================
function showToast(message, type = 'error') {
  const container = document.getElementById('toastContainer');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-hide');
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Kategori bahan & resep sekarang data dinamis (dikelola lewat UI), dimuat dari API saat startup
let ingCategoriesCache = [];
let recCategoriesCache = [];

// Konversi satuan (mirror dari backend/utils/unitConversion.js)
const UNIT_ALIASES = {
  g: 'g', gr: 'g', gram: 'g',
  kg: 'kg', kilogram: 'kg',
  mg: 'mg', miligram: 'mg',
  ml: 'ml', mililiter: 'ml',
  l: 'l', liter: 'l', litre: 'l',
};
const UNIT_GROUPS = {
  mass: { g: 1, kg: 1000, mg: 0.001 },
  volume: { ml: 1, l: 1000 },
};

function normalizeUnit(unit) {
  if (!unit) return null;
  const key = unit.trim().toLowerCase();
  return UNIT_ALIASES[key] || key;
}

function getCompatibleUnits(baseUnit) {
  const normalized = normalizeUnit(baseUnit);
  for (const factors of Object.values(UNIT_GROUPS)) {
    if (normalized in factors) return Object.keys(factors);
  }
  return [baseUnit]; // satuan tidak dikenali -> tidak bisa dikonversi, hanya satuan aslinya
}

// ambil elemen-elemen penting
const supplierForm = document.getElementById('supplierForm');
const supFormTitle = document.getElementById('supFormTitle');
const supSubmitBtn = document.getElementById('supSubmitBtn');
const supCancelBtn = document.getElementById('supCancelBtn');
const supplierTableBody = document.querySelector('#supplierTable tbody');
const supSearchInputEl = document.getElementById('supSearchInput');

const ingredientForm = document.getElementById('ingredientForm');
const ingFormTitle = document.getElementById('ingFormTitle');
const ingSubmitBtn = document.getElementById('ingSubmitBtn');
const ingCancelBtn = document.getElementById('ingCancelBtn');
const ingredientTableBody = document.querySelector('#ingredientTable tbody');
const ingSupplierSelect = document.getElementById('ingSupplier');
const ingSearchInput = document.getElementById('ingSearchInput');
const ingFilterSupplier = document.getElementById('ingFilterSupplier');
const ingFilterCategory = document.getElementById('ingFilterCategory');
const ingCategorySelect = document.getElementById('ingCategory');
const ingPaginationEl = document.getElementById('ingPagination');

const recipeForm = document.getElementById('recipeForm');
const recFormTitle = document.getElementById('recFormTitle');
const recSubmitBtn = document.getElementById('recSubmitBtn');
const recCancelBtn = document.getElementById('recCancelBtn');
const recTargetPercent = document.getElementById('recTargetPercent');
const recCategorySelect = document.getElementById('recCategory');
const recFilterCategory = document.getElementById('recFilterCategory');
const recipeIngredientForm = document.getElementById('recipeIngredientForm');
const recipeSelect = document.getElementById('recipeSelect');
const ingredientSelect = document.getElementById('ingredientSelect');
const usedUnitSelect = document.getElementById('usedUnitSelect');
const recipeList = document.getElementById('recipeList');
const recSearchInput = document.getElementById('recSearchInput');
const recPaginationEl = document.getElementById('recPagination');
const menuSearchInput = document.getElementById('menuSearchInput');
const menuFilterCategory = document.getElementById('menuFilterCategory');
const menuTableBody = document.querySelector('#menuTable tbody');

const modalOverlay = document.getElementById('modalOverlay');
const modalTitle = document.getElementById('modalTitle');
const modalBody = document.getElementById('modalBody');
const modalCloseBtn = document.getElementById('modalCloseBtn');

const loginOverlay = document.getElementById('loginOverlay');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const bootstrapForm = document.getElementById('bootstrapForm');
const appMain = document.getElementById('appMain');
const userBar = document.getElementById('userBar');
const userInfo = document.getElementById('userInfo');
const logoutBtn = document.getElementById('logoutBtn');
const profileBtn = document.getElementById('profileBtn');
const profileModalOverlay = document.getElementById('profileModalOverlay');
const profileModalCloseBtn = document.getElementById('profileModalCloseBtn');
const profileForm = document.getElementById('profileForm');
const userTabBtn = document.getElementById('userTabBtn');
const userForm = document.getElementById('userForm');
const userTableBody = document.querySelector('#userTable tbody');
const userSearchInputEl = document.getElementById('userSearchInput');

// state untuk search & pagination
let currentSuppliers = [];
let supSearchTerm = '';
let currentUsers = [];
let userSearchTerm = '';
let currentIngredientsOnPage = [];
let allIngredientsCache = [];
let ingSearchTerm = '';
let ingFilterSupplierId = '';
let ingFilterCategoryValue = '';
let ingCurrentPage = 1;
const ingLimit = 10;

let recSearchTerm = '';
let recFilterCategoryValue = '';
let menuListCache = [];
let menuSearchTerm = '';
let menuFilterCategoryValue = '';
let recCurrentPage = 1;
const recLimit = 5;

// ==========================
// HELPER: Debounce (menunda eksekusi supaya tidak fetch tiap ketikan)
// ==========================
function debounce(fn, delay) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

// ==========================
// HELPER: Render kontrol pagination
// ==========================
function renderPagination(container, result, onPageChange) {
  container.innerHTML = '';
  if (result.totalPages <= 1) return;

  const prevBtn = document.createElement('button');
  prevBtn.type = 'button';
  prevBtn.textContent = '← Sebelumnya';
  prevBtn.disabled = result.page <= 1;
  prevBtn.addEventListener('click', () => onPageChange(result.page - 1));

  const info = document.createElement('span');
  info.textContent = `Halaman ${result.page} dari ${result.totalPages} (${result.total} data)`;

  const nextBtn = document.createElement('button');
  nextBtn.type = 'button';
  nextBtn.textContent = 'Berikutnya →';
  nextBtn.disabled = result.page >= result.totalPages;
  nextBtn.addEventListener('click', () => onPageChange(result.page + 1));

  container.appendChild(prevBtn);
  container.appendChild(info);
  container.appendChild(nextBtn);
}

// ==========================
// TAB NAVIGATION: Dashboard / Supplier / Bahan Baku / Resep / User
// ==========================
function switchTab(tabName) {
  document.querySelectorAll('.tab-content').forEach((el) => { el.style.display = 'none'; });
  document.querySelectorAll('.tab-btn').forEach((btn) => btn.classList.remove('active'));

  const content = document.getElementById(`tab-${tabName}`);
  const btn = document.querySelector(`.tab-btn[data-tab="${tabName}"]`);
  if (content) content.style.display = '';
  if (btn) btn.classList.add('active');
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ==========================
// HELPER: Modal (dipakai untuk riwayat harga bahan)
// ==========================
function openModal(title, bodyHtml) {
  modalTitle.textContent = title;
  modalBody.innerHTML = bodyHtml;
  modalOverlay.style.display = 'flex';
}

function closeModal() {
  modalOverlay.style.display = 'none';
}

modalCloseBtn.addEventListener('click', closeModal);
modalOverlay.addEventListener('click', (e) => {
  if (e.target === modalOverlay) closeModal();
});

// ==========================
// FUNGSI: Kategori bahan & resep — muat dari API, isi dropdown, render tabel kelola kategori
// ==========================
function populateSelectWithCategories(selectEl, categories, placeholderText) {
  const keepValue = selectEl.value;
  selectEl.innerHTML = `<option value="">${placeholderText}</option>`;
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.name;
    opt.textContent = cat.name;
    selectEl.appendChild(opt);
  });
  selectEl.value = keepValue;
}

function renderCategoryManagerTable(tableId, categories, type) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  tbody.innerHTML = '';
  categories.forEach(cat => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="text" value="${cat.name}" class="cat-name-input"></td>
      <td class="category-row-actions">
        <button type="button" class="cat-save-btn" data-type="${type}" data-id="${cat.id}">💾 Simpan</button>
        <button type="button" class="cat-delete-btn" data-type="${type}" data-id="${cat.id}">🗑️ Hapus</button>
      </td>
    `;
    tbody.appendChild(row);
  });
}

async function loadIngredientCategories() {
  try {
    const res = await apiFetch(`${API_URL}/categories/ingredients`);
    ingCategoriesCache = await res.json();
    populateSelectWithCategories(ingCategorySelect, ingCategoriesCache, 'Tanpa kategori');
    populateSelectWithCategories(ingFilterCategory, ingCategoriesCache, 'Semua Kategori');
    renderCategoryManagerTable('ingCategoryTable', ingCategoriesCache, 'ingredient');
  } catch (err) {
    console.error('Gagal memuat kategori bahan:', err);
  }
}

async function loadRecipeCategories() {
  try {
    const res = await apiFetch(`${API_URL}/categories/recipes`);
    recCategoriesCache = await res.json();
    populateSelectWithCategories(recCategorySelect, recCategoriesCache, 'Tanpa kategori');
    populateSelectWithCategories(recFilterCategory, recCategoriesCache, 'Semua Kategori');
    populateSelectWithCategories(menuFilterCategory, recCategoriesCache, 'Semua Kategori');
    renderCategoryManagerTable('recCategoryTable', recCategoriesCache, 'recipe');
  } catch (err) {
    console.error('Gagal memuat kategori resep:', err);
  }
}

async function saveCategoryRename(type, id, newName) {
  const endpoint = type === 'ingredient' ? 'ingredients' : 'recipes';
  try {
    const res = await apiFetch(`${API_URL}/categories/${endpoint}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal mengubah nama kategori');

    showToast('Kategori berhasil diganti nama', 'success');
    if (type === 'ingredient') {
      await loadIngredientCategories();
      loadIngredients();
    } else {
      await loadRecipeCategories();
      loadRecipes();
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
}

async function deleteCategory(type, id) {
  const confirmDelete = confirm('Yakin ingin menghapus kategori ini?');
  if (!confirmDelete) return;

  const endpoint = type === 'ingredient' ? 'ingredients' : 'recipes';
  try {
    const res = await apiFetch(`${API_URL}/categories/${endpoint}/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menghapus kategori');

    showToast('Kategori dihapus', 'success');
    if (type === 'ingredient') {
      loadIngredientCategories();
    } else {
      loadRecipeCategories();
    }
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('cat-save-btn')) {
    const input = e.target.closest('tr').querySelector('.cat-name-input');
    const newName = input.value.trim();
    if (!newName) {
      showToast('Nama kategori tidak boleh kosong');
      return;
    }
    saveCategoryRename(e.target.dataset.type, e.target.dataset.id, newName);
  }
  if (e.target.classList.contains('cat-delete-btn')) {
    deleteCategory(e.target.dataset.type, e.target.dataset.id);
  }
});

document.getElementById('ingCategoryAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('newIngCategoryName');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const res = await apiFetch(`${API_URL}/categories/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menambah kategori');

    nameInput.value = '';
    loadIngredientCategories();
    showToast(`Kategori "${result.name}" ditambahkan`, 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

document.getElementById('recCategoryAddForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nameInput = document.getElementById('newRecCategoryName');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const res = await apiFetch(`${API_URL}/categories/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menambah kategori');

    nameInput.value = '';
    loadRecipeCategories();
    showToast(`Kategori "${result.name}" ditambahkan`, 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// FUNGSI: Tampilkan riwayat harga satu bahan lewat modal
// ==========================
async function showPriceHistory(ingredientId) {
  try {
    const ing = currentIngredientsOnPage.find(i => i.id === Number(ingredientId))
      || allIngredientsCache.find(i => i.id === Number(ingredientId));

    const res = await apiFetch(`${API_URL}/ingredients/${ingredientId}/price-history`);
    const history = await res.json();

    const rowsHtml = history.map(h => `
      <tr>
        <td>${new Date(h.changed_at.replace(' ', 'T')).toLocaleString('id-ID')}</td>
        <td>Rp${Number(h.price_per_unit).toLocaleString('id-ID')}</td>
      </tr>
    `).join('');

    const bodyHtml = `
      <table>
        <thead><tr><th>Tanggal</th><th>Harga</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="2"><em>Belum ada riwayat perubahan harga</em></td></tr>'}</tbody>
      </table>
    `;

    openModal(`Riwayat Harga${ing ? ': ' + ing.name : ''}`, bodyHtml);
  } catch (err) {
    showToast('Gagal memuat riwayat harga: ' + err.message);
  }
}

// ==========================
// FUNGSI: Ambil & Tampilkan Suppliers (tabel + dropdown ingredient + filter)
// ==========================
async function loadSuppliers() {
  try {
    const res = await apiFetch(`${API_URL}/suppliers`);
    const suppliers = await res.json();
    currentSuppliers = suppliers;

    applySupplierFilter();
    populateSupplierDropdowns(suppliers);
  } catch (err) {
    console.error('Gagal memuat suppliers:', err);
  }
}

// Filter currentSuppliers (di client, datanya kecil) berdasarkan supSearchTerm lalu render ulang
function applySupplierFilter() {
  const term = supSearchTerm.trim().toLowerCase();
  const filtered = !term
    ? currentSuppliers
    : currentSuppliers.filter(sup =>
        sup.name.toLowerCase().includes(term) || (sup.contact || '').toLowerCase().includes(term)
      );
  renderSupplierTable(filtered);
}

function renderSupplierTable(suppliers) {
  supplierTableBody.innerHTML = '';
  suppliers.forEach(sup => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${sup.name}</td>
      <td>${sup.contact || '-'}</td>
      <td>
        <button class="edit-btn" data-id="${sup.id}" data-type="supplier">✏️ Edit</button>
        <button class="delete-btn" data-id="${sup.id}" data-type="supplier">🗑️ Hapus</button>
      </td>
    `;
    supplierTableBody.appendChild(row);
  });
}

function populateSupplierDropdowns(suppliers) {
  const keepIngValue = ingSupplierSelect.value;
  ingSupplierSelect.innerHTML = '<option value="">Pilih Supplier</option>';
  suppliers.forEach(sup => {
    const option = document.createElement('option');
    option.value = sup.id;
    option.textContent = sup.name;
    ingSupplierSelect.appendChild(option);
  });
  ingSupplierSelect.value = keepIngValue;

  const keepFilterValue = ingFilterSupplier.value;
  ingFilterSupplier.innerHTML = '<option value="">Semua Supplier</option>';
  suppliers.forEach(sup => {
    const option = document.createElement('option');
    option.value = sup.id;
    option.textContent = sup.name;
    ingFilterSupplier.appendChild(option);
  });
  ingFilterSupplier.value = keepFilterValue;
}

// ==========================
// FUNGSI: Dropdown bahan untuk form "Tambah Bahan ke Resep" (selalu daftar penuh)
// ==========================
async function loadIngredientDropdown() {
  try {
    const res = await apiFetch(`${API_URL}/ingredients`);
    const ingredients = await res.json();
    allIngredientsCache = ingredients;

    ingredientSelect.innerHTML = '<option value="">Pilih Bahan</option>';
    ingredients.forEach(ing => {
      const option = document.createElement('option');
      option.value = ing.id;
      option.textContent = `${ing.name} (${ing.unit})`;
      ingredientSelect.appendChild(option);
    });
    usedUnitSelect.innerHTML = '<option value="">Satuan</option>';
  } catch (err) {
    console.error('Gagal memuat daftar bahan:', err);
  }
}

// ==========================
// EVENT: Saat bahan dipilih di form "Tambah Bahan ke Resep", isi pilihan satuan yang kompatibel
// ==========================
ingredientSelect.addEventListener('change', () => {
  const ing = allIngredientsCache.find(i => i.id === Number(ingredientSelect.value));
  usedUnitSelect.innerHTML = '';

  if (!ing) {
    usedUnitSelect.innerHTML = '<option value="">Satuan</option>';
    return;
  }

  const compatibleUnits = getCompatibleUnits(ing.unit);
  compatibleUnits.forEach(u => {
    const option = document.createElement('option');
    option.value = u;
    option.textContent = u;
    usedUnitSelect.appendChild(option);
  });
  usedUnitSelect.value = normalizeUnit(ing.unit) || ing.unit;
});

// ==========================
// FUNGSI: Ambil & Tampilkan Ingredients (tabel, dengan search/filter/pagination)
// ==========================
async function loadIngredients() {
  try {
    const params = new URLSearchParams({ page: ingCurrentPage, limit: ingLimit });
    if (ingSearchTerm) params.set('search', ingSearchTerm);
    if (ingFilterSupplierId) params.set('supplier_id', ingFilterSupplierId);
    if (ingFilterCategoryValue) params.set('category', ingFilterCategoryValue);

    const res = await apiFetch(`${API_URL}/ingredients?${params.toString()}`);
    const result = await res.json();
    currentIngredientsOnPage = result.data;

    ingredientTableBody.innerHTML = '';
    result.data.forEach(ing => {
      const supplier = currentSuppliers.find(s => s.id === ing.supplier_id);
      const supplierName = supplier ? supplier.name : '-';

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${ing.name}</td>
        <td>${ing.unit}</td>
        <td>Rp${Number(ing.price_per_unit).toLocaleString('id-ID')}</td>
        <td>${ing.category || '-'}</td>
        <td>${supplierName}</td>
        <td>
          <button class="history-btn" data-id="${ing.id}" data-type="history">📈 Riwayat</button>
          <button class="edit-btn" data-id="${ing.id}" data-type="ingredient">✏️ Edit</button>
          <button class="delete-btn" data-id="${ing.id}" data-type="ingredient">🗑️ Hapus</button>
        </td>
      `;
      ingredientTableBody.appendChild(row);
    });

    renderPagination(ingPaginationEl, result, (page) => {
      ingCurrentPage = page;
      loadIngredients();
    });
  } catch (err) {
    console.error('Gagal memuat ingredients:', err);
  }
}

// ==========================
// FUNGSI: Dropdown resep untuk form "Tambah Bahan ke Resep" (selalu daftar penuh)
// ==========================
async function loadRecipeDropdown() {
  try {
    const res = await apiFetch(`${API_URL}/recipes`);
    const recipes = await res.json();

    recipeSelect.innerHTML = '<option value="">Pilih Resep</option>';
    recipes.forEach(rec => {
      const option = document.createElement('option');
      option.value = rec.id;
      option.textContent = `${rec.name} (ID: ${rec.id}) - Rp${Number(rec.selling_price).toLocaleString('id-ID')}`;
      recipeSelect.appendChild(option);
    });
  } catch (err) {
    console.error('Gagal memuat daftar resep:', err);
  }
}

// ==========================
// FUNGSI: Tab Menu - daftar ringkas nama dish + harga (tanpa detail HPP)
// ==========================
async function loadMenuList() {
  try {
    const res = await apiFetch(`${API_URL}/recipes`);
    menuListCache = await res.json();
    applyMenuFilter();
  } catch (err) {
    console.error('Gagal memuat daftar menu:', err);
  }
}

function applyMenuFilter() {
  const term = menuSearchTerm.trim().toLowerCase();
  const filtered = menuListCache.filter(rec => {
    const matchesSearch = !term || rec.name.toLowerCase().includes(term);
    const matchesCategory = !menuFilterCategoryValue || rec.category === menuFilterCategoryValue;
    return matchesSearch && matchesCategory;
  });

  menuTableBody.innerHTML = '';
  filtered
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(rec => {
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${rec.name}</td>
        <td>${rec.category || '-'}</td>
        <td>Rp${Number(rec.selling_price).toLocaleString('id-ID')}</td>
      `;
      menuTableBody.appendChild(row);
    });

  if (filtered.length === 0) {
    menuTableBody.innerHTML = '<tr><td colspan="3"><em>Tidak ada menu ditemukan</em></td></tr>';
  }
}

menuSearchInput.addEventListener('input', debounce((e) => {
  menuSearchTerm = e.target.value;
  applyMenuFilter();
}, 300));

menuFilterCategory.addEventListener('change', (e) => {
  menuFilterCategoryValue = e.target.value;
  applyMenuFilter();
});

// ==========================
// FUNGSI: Ambil & Tampilkan Recipes (kartu HPP, dengan search/pagination)
// ==========================
async function loadRecipes() {
  try {
    const params = new URLSearchParams({ page: recCurrentPage, limit: recLimit });
    if (recSearchTerm) params.set('search', recSearchTerm);
    if (recFilterCategoryValue) params.set('category', recFilterCategoryValue);

    const res = await apiFetch(`${API_URL}/recipes?${params.toString()}`);
    const result = await res.json();

    recipeList.innerHTML = '';
    for (const rec of result.data) {
      const detailRes = await apiFetch(`${API_URL}/recipes/${rec.id}`);
      const detail = await detailRes.json();
      renderRecipeCard(detail);
    }

    renderPagination(recPaginationEl, result, (page) => {
      recCurrentPage = page;
      loadRecipes();
    });
  } catch (err) {
    console.error('Gagal memuat recipes:', err);
  }
}

// ==========================
// FUNGSI: Ambil & Tampilkan Dashboard Ringkasan
// ==========================
async function loadDashboard() {
  try {
    const res = await apiFetch(`${API_URL}/reports/dashboard`);
    const data = await res.json();
    const s = data.summary;

    document.getElementById('dashboardSummary').innerHTML = `
      <div class="stat-card"><div class="stat-value">${s.total_recipes}</div><div class="stat-label">Total Resep</div></div>
      <div class="stat-card"><div class="stat-value">${s.total_ingredients}</div><div class="stat-label">Total Bahan Baku</div></div>
      <div class="stat-card"><div class="stat-value">${s.total_suppliers}</div><div class="stat-label">Total Supplier</div></div>
      <div class="stat-card"><div class="stat-value">${s.avg_food_cost_percentage !== null ? s.avg_food_cost_percentage + '%' : '-'}</div><div class="stat-label">Rata-rata Food Cost</div></div>
      <div class="stat-card"><div class="stat-value">${s.recipes_over_target}</div><div class="stat-label">Resep Melebihi Target</div></div>
    `;

    const mostProfitableList = document.getElementById('mostProfitableList');
    mostProfitableList.innerHTML = data.most_profitable_recipes
      .map(r => `<li>${r.name} — ${r.food_cost_percentage}%</li>`)
      .join('') || '<li><em>Belum ada data</em></li>';

    const leastProfitableList = document.getElementById('leastProfitableList');
    leastProfitableList.innerHTML = data.least_profitable_recipes
      .map(r => `<li>${r.name} — ${r.food_cost_percentage}%</li>`)
      .join('') || '<li><em>Belum ada data</em></li>';

    const expensiveList = document.getElementById('expensiveIngredientsList');
    expensiveList.innerHTML = data.most_expensive_ingredients
      .map(i => `<li>${i.name} — Rp${Number(i.price_per_unit).toLocaleString('id-ID')}/${i.unit}</li>`)
      .join('') || '<li><em>Belum ada data</em></li>';

    const overTargetSection = document.getElementById('overTargetSection');
    const overTargetList = document.getElementById('overTargetList');
    if (data.over_target_recipes.length > 0) {
      overTargetSection.style.display = '';
      overTargetList.innerHTML = data.over_target_recipes
        .map(r => `<li>${r.name} — ${r.food_cost_percentage}% (target ${r.target_food_cost_percent}%)</li>`)
        .join('');
    } else {
      overTargetSection.style.display = 'none';
    }
  } catch (err) {
    console.error('Gagal memuat dashboard:', err);
  }
}

// ==========================
// FUNGSI: Tentukan warna badge berdasarkan food cost %
// ==========================
function getBadgeColor(percentage) {
  const pct = Number(percentage);
  if (pct <= 30) return '#2e7d32';   // hijau - aman
  if (pct <= 40) return '#f9a825';   // kuning - waspada
  return '#c62828';                   // merah - bahaya
}

// ==========================
// FUNGSI: Render 1 Card Detail Recipe
// ==========================
function renderRecipeCard(recipe) {
  const div = document.createElement('div');
  div.className = 'recipe-item';

  const ingredientListHtml = recipe.ingredients.map(ing => {
    const displayUnit = ing.used_unit || ing.unit;
    return `<li>${ing.name} — ${ing.quantity_used} ${displayUnit} (Rp${Number(ing.price_per_unit).toLocaleString('id-ID')}/${ing.unit})</li>`;
  }).join('');

  const hasPercentage = recipe.food_cost_percentage !== null;
  const badgeColor = hasPercentage ? getBadgeColor(recipe.food_cost_percentage) : '#888';
  const badgeText = hasPercentage ? `${recipe.food_cost_percentage}%` : 'N/A';

  const overTargetHtml = recipe.over_target
    ? `<div class="over-target-alert">⚠️ Melebihi target food cost (${recipe.target_food_cost_percent}%)</div>`
    : '';

  div.innerHTML = `
    <h3>${recipe.name} (ID: ${recipe.id})</h3>
    ${recipe.category ? `<p class="target-info">🏷️ ${recipe.category}</p>` : ''}
    <p>Harga Jual: Rp${Number(recipe.selling_price).toLocaleString('id-ID')} | Porsi: ${recipe.portion_yield}</p>
    <ul>${ingredientListHtml || '<li><em>Belum ada bahan</em></li>'}</ul>
    <p><strong>HPP Total:</strong> Rp${Number(recipe.hpp_total).toLocaleString('id-ID')}</p>
    <p><strong>HPP per Porsi:</strong> Rp${Number(recipe.hpp_per_portion).toLocaleString('id-ID')}</p>
    <p class="food-cost-badge" style="background-color: ${badgeColor};"><strong>Food Cost:</strong> ${badgeText}</p>
    <p class="target-info">Target Food Cost: ${recipe.target_food_cost_percent}%</p>
    ${overTargetHtml}
    <div class="form-actions" style="margin-top: 10px;">
      <button class="edit-btn" data-id="${recipe.id}" data-type="recipe">✏️ Edit</button>
      <button class="delete-btn" data-id="${recipe.id}" data-type="recipe">🗑️ Hapus Resep</button>
    </div>
  `;

  recipeList.appendChild(div);
}

// ==========================
// EDIT MODE: Supplier
// ==========================
function startEditSupplier(sup) {
  document.getElementById('supId').value = sup.id;
  document.getElementById('supName').value = sup.name;
  document.getElementById('supContact').value = sup.contact || '';
  supFormTitle.textContent = 'Edit Supplier';
  supSubmitBtn.textContent = 'Update Supplier';
  supCancelBtn.style.display = 'inline-block';
  supplierForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditSupplier() {
  supplierForm.reset();
  document.getElementById('supId').value = '';
  supFormTitle.textContent = 'Tambah Supplier';
  supSubmitBtn.textContent = 'Tambah Supplier';
  supCancelBtn.style.display = 'none';
}

supCancelBtn.addEventListener('click', cancelEditSupplier);

// ==========================
// EDIT MODE: Ingredient
// ==========================
function startEditIngredient(ing) {
  document.getElementById('ingId').value = ing.id;
  document.getElementById('ingName').value = ing.name;
  document.getElementById('ingUnit').value = ing.unit;
  document.getElementById('ingPrice').value = ing.price_per_unit;
  ingSupplierSelect.value = ing.supplier_id || '';
  ingCategorySelect.value = ing.category || '';
  ingFormTitle.textContent = 'Edit Bahan Baku';
  ingSubmitBtn.textContent = 'Update Bahan';
  ingCancelBtn.style.display = 'inline-block';
  ingredientForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditIngredient() {
  ingredientForm.reset();
  document.getElementById('ingId').value = '';
  ingFormTitle.textContent = 'Tambah Bahan Baku';
  ingSubmitBtn.textContent = 'Tambah Bahan';
  ingCancelBtn.style.display = 'none';
}

ingCancelBtn.addEventListener('click', cancelEditIngredient);

// ==========================
// EDIT MODE: Recipe
// ==========================
function startEditRecipe(rec) {
  document.getElementById('recId').value = rec.id;
  document.getElementById('recName').value = rec.name;
  document.getElementById('recPrice').value = rec.selling_price;
  document.getElementById('recPortion').value = rec.portion_yield;
  recTargetPercent.value = rec.target_food_cost_percent || '';
  recCategorySelect.value = rec.category || '';
  recFormTitle.textContent = 'Edit Resep';
  recSubmitBtn.textContent = 'Update Resep';
  recCancelBtn.style.display = 'inline-block';
  recipeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditRecipe() {
  recipeForm.reset();
  document.getElementById('recId').value = '';
  recFormTitle.textContent = 'Tambah Resep';
  recSubmitBtn.textContent = 'Tambah Resep';
  recCancelBtn.style.display = 'none';
}

recCancelBtn.addEventListener('click', cancelEditRecipe);

// ==========================
// EVENT: Submit Form Supplier (tambah atau update)
// ==========================
supplierForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('supId').value;
  const name = document.getElementById('supName').value.trim();
  const contact = document.getElementById('supContact').value.trim();

  if (!name) {
    showToast('Nama supplier tidak boleh kosong');
    return;
  }

  const isEdit = Boolean(id);
  const url = isEdit ? `${API_URL}/suppliers/${id}` : `${API_URL}/suppliers`;
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, contact })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Gagal ${isEdit ? 'mengupdate' : 'menambah'} supplier`);

    cancelEditSupplier();
    loadSuppliers();
    loadDashboard();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// EVENT: Submit Form Ingredient (tambah atau update)
// ==========================
ingredientForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('ingId').value;
  const name = document.getElementById('ingName').value.trim();
  const unit = document.getElementById('ingUnit').value.trim();
  const price_per_unit = document.getElementById('ingPrice').value;
  const supplier_id = ingSupplierSelect.value;
  const category = ingCategorySelect.value || null;

  if (!name || !unit) {
    showToast('Nama dan satuan tidak boleh kosong');
    return;
  }
  if (price_per_unit === '' || isNaN(Number(price_per_unit)) || Number(price_per_unit) < 0) {
    showToast('Harga per satuan harus berupa angka dan tidak boleh negatif');
    return;
  }

  const isEdit = Boolean(id);
  const url = isEdit ? `${API_URL}/ingredients/${id}` : `${API_URL}/ingredients`;
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, unit, price_per_unit, supplier_id: supplier_id || null, category })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Gagal ${isEdit ? 'mengupdate' : 'menambah'} bahan`);

    cancelEditIngredient();
    loadIngredients();
    loadIngredientDropdown();
    loadRecipes(); // harga bahan bisa berubah -> HPP resep terkait perlu direfresh
    loadDashboard();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// EVENT: Submit Form Recipe (tambah atau update)
// ==========================
recipeForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('recId').value;
  const name = document.getElementById('recName').value.trim();
  const selling_price = document.getElementById('recPrice').value;
  const portion_yield = document.getElementById('recPortion').value;
  const targetPercentValue = recTargetPercent.value;

  if (!name) {
    showToast('Nama resep tidak boleh kosong');
    return;
  }
  if (selling_price === '' || isNaN(Number(selling_price)) || Number(selling_price) <= 0) {
    showToast('Harga jual harus berupa angka lebih dari 0');
    return;
  }
  if (portion_yield !== '' && (!Number.isInteger(Number(portion_yield)) || Number(portion_yield) <= 0)) {
    showToast('Jumlah porsi harus berupa angka bulat lebih dari 0');
    return;
  }
  if (targetPercentValue !== '' && (isNaN(Number(targetPercentValue)) || Number(targetPercentValue) <= 0)) {
    showToast('Target food cost % harus berupa angka lebih dari 0');
    return;
  }

  const isEdit = Boolean(id);
  const url = isEdit ? `${API_URL}/recipes/${id}` : `${API_URL}/recipes`;
  const method = isEdit ? 'PUT' : 'POST';

  try {
    const res = await apiFetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        selling_price,
        portion_yield: portion_yield || 1,
        target_food_cost_percent: targetPercentValue || undefined,
        category: recCategorySelect.value || null
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Gagal ${isEdit ? 'mengupdate' : 'menambah'} resep`);

    cancelEditRecipe();
    loadRecipes();
    loadRecipeDropdown();
    loadMenuList();
    loadDashboard();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// EVENT: Submit Form Tambah Bahan ke Recipe
// ==========================
recipeIngredientForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const recipeId = recipeSelect.value;
  const ingredient_id = ingredientSelect.value;
  const quantity_used = document.getElementById('qtyUsed').value;
  const unit = usedUnitSelect.value;

  if (!recipeId) {
    showToast('Pilih resep terlebih dahulu!');
    return;
  }
  if (!ingredient_id) {
    showToast('Pilih bahan terlebih dahulu!');
    return;
  }
  if (quantity_used === '' || isNaN(Number(quantity_used)) || Number(quantity_used) <= 0) {
    showToast('Jumlah dipakai harus berupa angka lebih dari 0');
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/recipes/${recipeId}/ingredients`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ingredient_id, quantity_used, unit })
    });

    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menambah bahan ke resep');

    // Sengaja tidak reset recipeSelect supaya bisa langsung tambah bahan berikutnya ke resep yang sama
    ingredientSelect.value = '';
    document.getElementById('qtyUsed').value = '';
    usedUnitSelect.innerHTML = '<option value="">Satuan</option>';
    loadRecipes();
    loadDashboard();
    showToast('Bahan berhasil ditambahkan ke resep', 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// FUNGSI: Hapus Ingredient, Recipe, atau Supplier
// ==========================
async function handleDelete(id, type) {
  const labels = { ingredient: 'bahan', recipe: 'resep', supplier: 'supplier' };
  const endpoints = { ingredient: 'ingredients', recipe: 'recipes', supplier: 'suppliers' };

  const confirmDelete = confirm(`Yakin ingin menghapus ${labels[type]} ini?`);
  if (!confirmDelete) return;

  try {
    const res = await apiFetch(`${API_URL}/${endpoints[type]}/${id}`, {
      method: 'DELETE'
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Gagal menghapus ${labels[type]}`);

    if (type === 'ingredient') {
      loadIngredients();
      loadIngredientDropdown();
      loadRecipes();
    } else if (type === 'recipe') {
      loadRecipes();
      loadRecipeDropdown();
      loadMenuList();
    } else if (type === 'supplier') {
      loadSuppliers();
    }
    loadDashboard();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
}

// ==========================
// FUNGSI: Klik tombol edit -> muat data terbaru lalu masuk mode edit
// ==========================
async function handleEditClick(type, id) {
  try {
    if (type === 'supplier') {
      const sup = currentSuppliers.find(s => s.id === Number(id));
      if (sup) startEditSupplier(sup);
    } else if (type === 'ingredient') {
      const res = await apiFetch(`${API_URL}/ingredients/${id}`);
      const ing = await res.json();
      startEditIngredient(ing);
    } else if (type === 'recipe') {
      const res = await apiFetch(`${API_URL}/recipes/${id}`);
      const rec = await res.json();
      startEditRecipe(rec);
    }
  } catch (err) {
    showToast('Gagal memuat data untuk diedit: ' + err.message);
  }
}

// ==========================
// EVENT: Delegasi klik tombol edit & delete (pakai event delegation)
// ==========================
document.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-btn') && e.target.dataset.type !== 'user') {
    handleDelete(e.target.dataset.id, e.target.dataset.type);
  }
  if (e.target.classList.contains('edit-btn')) {
    handleEditClick(e.target.dataset.type, e.target.dataset.id);
  }
  if (e.target.classList.contains('history-btn')) {
    showPriceHistory(e.target.dataset.id);
  }
});

// ==========================
// EVENT: Search & filter (dengan debounce untuk input teks)
// ==========================
ingSearchInput.addEventListener('input', debounce((e) => {
  ingSearchTerm = e.target.value;
  ingCurrentPage = 1;
  loadIngredients();
}, 300));

ingFilterSupplier.addEventListener('change', (e) => {
  ingFilterSupplierId = e.target.value;
  ingCurrentPage = 1;
  loadIngredients();
});

ingFilterCategory.addEventListener('change', (e) => {
  ingFilterCategoryValue = e.target.value;
  ingCurrentPage = 1;
  loadIngredients();
});

recSearchInput.addEventListener('input', debounce((e) => {
  recSearchTerm = e.target.value;
  recCurrentPage = 1;
  loadRecipes();
}, 300));

recFilterCategory.addEventListener('change', (e) => {
  recFilterCategoryValue = e.target.value;
  recCurrentPage = 1;
  loadRecipes();
});

supSearchInputEl.addEventListener('input', debounce((e) => {
  supSearchTerm = e.target.value;
  applySupplierFilter();
}, 300));

userSearchInputEl.addEventListener('input', debounce((e) => {
  userSearchTerm = e.target.value;
  applyUserFilter();
}, 300));

// ==========================
// AUTH: tampilkan/sembunyikan overlay login, render info user
// ==========================
function showLoginOverlay() {
  loginOverlay.style.display = 'flex';
  appMain.style.display = 'none';
  userBar.style.display = 'none';
}

function hideLoginOverlay() {
  loginOverlay.style.display = 'none';
  appMain.style.display = '';
  userBar.style.display = 'flex';
}

function renderUserBar() {
  userInfo.textContent = `${currentUser.username} (${currentUser.role === 'admin' ? 'Admin' : 'Staff'})`;
  document.body.classList.toggle('role-staff', currentUser.role !== 'admin');
  userTabBtn.style.display = currentUser.role === 'admin' ? '' : 'none';
}

// ==========================
// EVENT: Login
// ==========================
loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const username = document.getElementById('loginUsername').value.trim();
  const password = document.getElementById('loginPassword').value;

  try {
    const res = await fetch(`${API_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Login gagal');

    setSession(result.token, result.user);
    loginForm.reset();
    await startApp();
  } catch (err) {
    loginError.textContent = err.message;
    loginError.style.display = 'block';
  }
});

// ==========================
// EVENT: Daftar admin pertama (bootstrap, hanya jalan kalau belum ada user sama sekali)
// ==========================
bootstrapForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.style.display = 'none';

  const username = document.getElementById('bootstrapUsername').value.trim();
  const password = document.getElementById('bootstrapPassword').value;

  try {
    const res = await fetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal mendaftar');

    bootstrapForm.reset();
    showToast(`Admin "${result.username}" berhasil dibuat. Silakan login.`, 'success');
  } catch (err) {
    loginError.textContent = err.message;
    loginError.style.display = 'block';
  }
});

// ==========================
// EVENT: Logout
// ==========================
logoutBtn.addEventListener('click', () => {
  clearSession();
  showLoginOverlay();
});

// ==========================
// EVENT: Ganti Profil (username & password akun sendiri)
// ==========================
profileBtn.addEventListener('click', () => {
  profileForm.reset();
  profileModalOverlay.style.display = 'flex';
});

profileModalCloseBtn.addEventListener('click', () => {
  profileModalOverlay.style.display = 'none';
});

profileModalOverlay.addEventListener('click', (e) => {
  if (e.target === profileModalOverlay) profileModalOverlay.style.display = 'none';
});

profileForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const newUsername = document.getElementById('profileNewUsername').value.trim();
  const newPassword = document.getElementById('profileNewPassword').value;
  const newPasswordConfirm = document.getElementById('profileNewPasswordConfirm').value;
  const currentPassword = document.getElementById('profileCurrentPassword').value;

  if (!newUsername && !newPassword) {
    showToast('Isi username baru dan/atau password baru dulu');
    return;
  }
  if (newPassword && newPassword.length < 6) {
    showToast('Password baru minimal 6 karakter');
    return;
  }
  if (newPassword && newPassword !== newPasswordConfirm) {
    showToast('Konfirmasi password baru tidak cocok');
    return;
  }
  if (!currentPassword) {
    showToast('Password saat ini wajib diisi untuk konfirmasi');
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/auth/me`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        current_password: currentPassword,
        new_username: newUsername || undefined,
        new_password: newPassword || undefined
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal mengubah profil');

    setSession(result.token, result.user);
    renderUserBar();
    profileForm.reset();
    profileModalOverlay.style.display = 'none';
    showToast('Profil berhasil diperbarui', 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// FUNGSI: Manajemen User (khusus admin)
// ==========================
async function loadUsers() {
  if (currentUser.role !== 'admin') return;
  try {
    const res = await apiFetch(`${API_URL}/auth/users`);
    currentUsers = await res.json();
    applyUserFilter();
  } catch (err) {
    console.error('Gagal memuat daftar user:', err);
  }
}

// Filter currentUsers (di client, datanya kecil) berdasarkan userSearchTerm lalu render ulang
function applyUserFilter() {
  const term = userSearchTerm.trim().toLowerCase();
  const filtered = !term
    ? currentUsers
    : currentUsers.filter(u => u.username.toLowerCase().includes(term));
  renderUserTable(filtered);
}

function renderUserTable(users) {
  userTableBody.innerHTML = '';
  users.forEach(u => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${u.username}</td>
      <td>${u.role === 'admin' ? 'Admin' : 'Staff'}</td>
      <td>${u.id === currentUser.id ? '<em>Akun Anda</em>' : `<button class="delete-btn" data-id="${u.id}" data-type="user">🗑️ Hapus</button>`}</td>
    `;
    userTableBody.appendChild(row);
  });
}

userForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const username = document.getElementById('newUsername').value.trim();
  const password = document.getElementById('newPassword').value;
  const role = document.getElementById('newUserRole').value;

  if (!username) {
    showToast('Username tidak boleh kosong');
    return;
  }
  if (password.length < 6) {
    showToast('Password minimal 6 karakter');
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password, role })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menambah user');

    userForm.reset();
    loadUsers();
    showToast(`User "${result.username}" berhasil ditambahkan`, 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

async function handleDeleteUser(id) {
  const confirmDelete = confirm('Yakin ingin menghapus user ini?');
  if (!confirmDelete) return;

  try {
    const res = await apiFetch(`${API_URL}/auth/users/${id}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menghapus user');
    loadUsers();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('delete-btn') && e.target.dataset.type === 'user') {
    handleDeleteUser(e.target.dataset.id);
  }
});

// ==========================
// INISIALISASI: Jalankan saat halaman dimuat
// ==========================
async function startApp() {
  hideLoginOverlay();
  renderUserBar();
  switchTab('dashboard');

  await loadSuppliers(); // harus selesai dulu supaya nama supplier bisa ditampilkan di tabel bahan
  await Promise.all([
    loadIngredientCategories(),
    loadRecipeCategories(),
    loadIngredients(),
    loadIngredientDropdown(),
    loadRecipes(),
    loadRecipeDropdown(),
    loadMenuList(),
    loadDashboard(),
    loadUsers()
  ]);
}

async function init() {
  const token = getToken();
  const storedUser = localStorage.getItem('user');

  if (!token || !storedUser) {
    showLoginOverlay();
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/auth/me`);
    if (!res.ok) throw new Error('invalid session');
    const data = await res.json();
    currentUser = data.user;
    localStorage.setItem('user', JSON.stringify(currentUser));
    await startApp();
  } catch (err) {
    clearSession();
    showLoginOverlay();
  }
}

init();

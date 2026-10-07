const API_URL = API_BASE_URL; // didefinisikan di config.js, dimuat sebelum file ini

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
const ingIsBasedProduct = document.getElementById('ingIsBasedProduct');
const ingPriceInput = document.getElementById('ingPrice');
const ingSourceRecipeSelect = document.getElementById('ingSourceRecipe');
const ingYieldQuantityInput = document.getElementById('ingYieldQuantity');
const ingPaginationEl = document.getElementById('ingPagination');

const recipeForm = document.getElementById('recipeForm');
const recFormTitle = document.getElementById('recFormTitle');
const recSubmitBtn = document.getElementById('recSubmitBtn');
const recCancelBtn = document.getElementById('recCancelBtn');
const recTargetPercent = document.getElementById('recTargetPercent');
const recCategorySelect = document.getElementById('recCategory');
const recFilterCategory = document.getElementById('recFilterCategory');
const recYieldFields = document.getElementById('recYieldFields');
const recYieldQuantityInput = document.getElementById('recYieldQuantity');
const recYieldUnitSelect = document.getElementById('recYieldUnit');
const recipeSelect = document.getElementById('recipeSelect');
const multiIngredientForm = document.getElementById('multiIngredientForm');
const multiIngredientRows = document.getElementById('multiIngredientRows');
const addIngredientRowBtn = document.getElementById('addIngredientRowBtn');
const editRiModalOverlay = document.getElementById('editRiModalOverlay');
const editRiModalCloseBtn = document.getElementById('editRiModalCloseBtn');
const editRiForm = document.getElementById('editRiForm');
const recipeList = document.getElementById('recipeList');
const recSearchInput = document.getElementById('recSearchInput');
const menuSearchInput = document.getElementById('menuSearchInput');
const menuFilterCategory = document.getElementById('menuFilterCategory');
const menuTableBody = document.querySelector('#menuTable tbody');
const exportRecipesExcelBtn = document.getElementById('exportRecipesExcelBtn');
const exportRecipesPdfBtn = document.getElementById('exportRecipesPdfBtn');
const exportIngredientsExcelBtn = document.getElementById('exportIngredientsExcelBtn');

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
const ingLimit = 25;

let recSearchTerm = '';
let recFilterCategoryValue = '';
let recipeDetailCache = [];
let menuListCache = [];
let menuSearchTerm = '';
let menuFilterCategoryValue = '';

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
// HELPER: Tombol Buka/Tutup di judul card (data-collapse="<id isi>"), posisinya diingat di browser
// ==========================
function setCollapsed(btn, collapsed) {
  const body = document.getElementById(btn.dataset.collapse);
  if (!body) return;
  body.style.display = collapsed ? 'none' : '';
  btn.textContent = collapsed ? '▸ Buka' : '▾ Tutup';
  btn.setAttribute('aria-expanded', String(!collapsed));
}

// Buka bagian yang sedang ditutup (misal form saat tombol Edit diklik)
function expandCollapse(bodyId) {
  const btn = document.querySelector(`[data-collapse="${bodyId}"]`);
  if (btn && btn.getAttribute('aria-expanded') === 'false') btn.click();
}

document.querySelectorAll('[data-collapse]').forEach((btn) => {
  let saved = null;
  try { saved = localStorage.getItem('collapse:' + btn.dataset.collapse); } catch (e) {}
  setCollapsed(btn, saved === '1');
  btn.addEventListener('click', () => {
    const collapsed = btn.getAttribute('aria-expanded') === 'true';
    setCollapsed(btn, collapsed);
    try { localStorage.setItem('collapse:' + btn.dataset.collapse, collapsed ? '1' : '0'); } catch (e) {}
  });
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
  const supportsBasedProduct = type === 'recipe';
  categories.forEach(cat => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td><input type="text" value="${cat.name}" class="cat-name-input"></td>
      ${supportsBasedProduct ? `<td><label class="checkbox-label"><input type="checkbox" class="cat-based-product-checkbox" ${cat.is_based_product_category ? 'checked' : ''}> 🔗 Based Product</label></td>` : ''}
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
    toggleRecipeYieldFields();
  } catch (err) {
    console.error('Gagal memuat kategori resep:', err);
  }
}

async function saveCategoryRename(type, id, newName, isBasedProductCategory) {
  const endpoint = type === 'ingredient' ? 'ingredients' : 'recipes';
  try {
    const body = { name: newName };
    if (typeof isBasedProductCategory === 'boolean') body.is_based_product_category = isBasedProductCategory;
    const res = await apiFetch(`${API_URL}/categories/${endpoint}/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
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
    const row = e.target.closest('tr');
    const input = row.querySelector('.cat-name-input');
    const newName = input.value.trim();
    if (!newName) {
      showToast('Nama kategori tidak boleh kosong');
      return;
    }
    const basedProductCheckbox = row.querySelector('.cat-based-product-checkbox');
    saveCategoryRename(e.target.dataset.type, e.target.dataset.id, newName, basedProductCheckbox ? basedProductCheckbox.checked : undefined);
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
  const isBasedProductInput = document.getElementById('newRecCategoryIsBasedProduct');
  const name = nameInput.value.trim();
  if (!name) return;

  try {
    const res = await apiFetch(`${API_URL}/categories/recipes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, is_based_product_category: isBasedProductInput.checked })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menambah kategori');

    nameInput.value = '';
    isBasedProductInput.checked = false;
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
// FUNGSI: Dropdown bahan untuk form "Tambah Bahan ke Resep" (selalu daftar penuh, dipakai di tiap baris)
// ==========================
async function loadIngredientDropdown() {
  try {
    const res = await apiFetch(`${API_URL}/ingredients`);
    allIngredientsCache = await res.json();
    refreshAllIngredientRowOptions();
  } catch (err) {
    console.error('Gagal memuat daftar bahan:', err);
  }
}

function buildIngredientOptionsHtml() {
  let html = '<option value="">Pilih Bahan</option>';
  allIngredientsCache.forEach(ing => {
    html += `<option value="${ing.id}">${ing.name} (${ing.unit})</option>`;
  });
  return html;
}

function defaultUnitOptionsHtml() {
  return `<option value="g">gr</option><option value="ml">ml</option><option value="pcs">pcs</option>`;
}

// Isi ulang pilihan bahan di semua baris yang sudah ada (dipanggil saat daftar bahan berubah),
// tanpa menghapus baris/isian yang sedang dikerjakan user.
function refreshAllIngredientRowOptions() {
  multiIngredientRows.querySelectorAll('.mi-ingredient').forEach(select => {
    const keepValue = select.value;
    select.innerHTML = buildIngredientOptionsHtml();
    select.value = keepValue;
  });
}

function renumberIngredientRows() {
  multiIngredientRows.querySelectorAll('tr').forEach((row, idx) => {
    row.querySelector('.mi-row-number').textContent = idx + 1;
  });
}

function createIngredientRow() {
  const tr = document.createElement('tr');
  tr.innerHTML = `
    <td class="mi-row-number"></td>
    <td><select class="mi-ingredient">${buildIngredientOptionsHtml()}</select></td>
    <td><input type="number" class="mi-qty" placeholder="Jumlah" min="0.01" step="0.01"></td>
    <td><select class="mi-unit">${defaultUnitOptionsHtml()}</select></td>
    <td><button type="button" class="mi-remove-row" title="Hapus baris ini">🗑️</button></td>
  `;
  multiIngredientRows.appendChild(tr);
  renumberIngredientRows();

  const ingredientSelectEl = tr.querySelector('.mi-ingredient');
  const unitSelectEl = tr.querySelector('.mi-unit');
  ingredientSelectEl.addEventListener('change', () => {
    const ing = allIngredientsCache.find(i => i.id === Number(ingredientSelectEl.value));
    if (!ing) {
      unitSelectEl.innerHTML = defaultUnitOptionsHtml();
      return;
    }
    const compatibleUnits = getCompatibleUnits(ing.unit);
    unitSelectEl.innerHTML = compatibleUnits.map(u => `<option value="${u}">${u}</option>`).join('');
    unitSelectEl.value = normalizeUnit(ing.unit) || ing.unit;
  });

  return tr;
}

function resetMultiIngredientRows(count = 3) {
  multiIngredientRows.innerHTML = '';
  for (let i = 0; i < count; i++) createIngredientRow();
}

addIngredientRowBtn.addEventListener('click', () => createIngredientRow());

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('mi-remove-row')) {
    if (multiIngredientRows.children.length <= 1) {
      showToast('Minimal harus ada 1 baris bahan');
      return;
    }
    e.target.closest('tr').remove();
    renumberIngredientRows();
  }
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

      const basedProductBadge = ing.source_recipe_id ? '<span class="based-product-badge">🔗 Based Product</span>' : '';
      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${ing.name}${basedProductBadge}</td>
        <td>${ing.unit}</td>
        <td>${!ing.source_recipe_id && !(Number(ing.price_per_unit) > 0)
          ? '<span class="no-price-badge">Belum ada harga</span>'
          : `Rp${Number(ing.price_per_unit).toLocaleString('id-ID')}`}</td>
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
    populateSourceRecipeDropdown();
  } catch (err) {
    console.error('Gagal memuat daftar menu:', err);
  }
}

// ==========================
// FUNGSI: Bahan "Based Product" - dropdown resep sumber & toggle field form
// ==========================
function populateSourceRecipeDropdown() {
  const keepValue = ingSourceRecipeSelect.value;
  ingSourceRecipeSelect.innerHTML = '<option value="">Pilih Resep Sumber</option>';
  menuListCache
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(rec => {
      const option = document.createElement('option');
      option.value = rec.id;
      option.textContent = rec.name;
      ingSourceRecipeSelect.appendChild(option);
    });
  ingSourceRecipeSelect.value = keepValue;
}

function toggleBasedProductFields(isBasedProduct) {
  ingSourceRecipeSelect.style.display = isBasedProduct ? '' : 'none';
  ingYieldQuantityInput.style.display = isBasedProduct ? '' : 'none';
  ingSourceRecipeSelect.required = isBasedProduct;
  ingYieldQuantityInput.required = isBasedProduct;
  ingSupplierSelect.required = !isBasedProduct;

  if (isBasedProduct) {
    ingPriceInput.value = '';
    ingPriceInput.required = false;
    ingPriceInput.disabled = true;
    ingPriceInput.placeholder = 'Otomatis dihitung dari resep sumber';
  } else {
    ingPriceInput.required = false; // harga boleh dikosongkan dulu, diisi nanti lewat Edit
    ingPriceInput.disabled = false;
    ingPriceInput.placeholder = 'Harga per satuan (opsional, bisa diisi nanti lewat Edit)';
  }
}

ingIsBasedProduct.addEventListener('change', (e) => {
  toggleBasedProductFields(e.target.checked);
});

// ==========================
// FUNGSI: Resep berkategori "Based Product" - tampilkan/sembunyikan field yield
// ==========================
function isSelectedRecipeCategoryBasedProduct() {
  const cat = recCategoriesCache.find(c => c.name === recCategorySelect.value);
  return Boolean(cat && cat.is_based_product_category);
}

function toggleRecipeYieldFields() {
  const show = isSelectedRecipeCategoryBasedProduct();
  recYieldFields.style.display = show ? '' : 'none';
  recYieldQuantityInput.required = show;
}

recCategorySelect.addEventListener('change', toggleRecipeYieldFields);

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
// FUNGSI: Ambil semua Recipes + HPP-nya, lalu tampilkan dikelompokkan per kategori
// ==========================
async function loadRecipes() {
  try {
    const res = await apiFetch(`${API_URL}/recipes`);
    const recipes = await res.json();

    recipeDetailCache = await Promise.all(
      recipes.map(async (rec) => {
        const detailRes = await apiFetch(`${API_URL}/recipes/${rec.id}`);
        return detailRes.json();
      })
    );

    renderGroupedRecipeList();
  } catch (err) {
    console.error('Gagal memuat recipes:', err);
  }
}

// Bikin id HTML yang aman dari nama kategori (dipakai untuk toggle buka/tutup per grup)
function slugifyForId(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'x';
}

function renderGroupedRecipeList() {
  const term = recSearchTerm.trim().toLowerCase();
  const filtered = recipeDetailCache.filter((rec) => {
    const matchesSearch = !term || rec.name.toLowerCase().includes(term);
    const matchesCategory = !recFilterCategoryValue || rec.category === recFilterCategoryValue;
    return matchesSearch && matchesCategory;
  });

  recipeList.innerHTML = '';

  if (filtered.length === 0) {
    recipeList.innerHTML = '<p><em>Tidak ada resep yang cocok.</em></p>';
    return;
  }

  const UNCATEGORIZED_LABEL = 'Tanpa Kategori';
  const groups = new Map();
  filtered.forEach((rec) => {
    const key = rec.category || UNCATEGORIZED_LABEL;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });

  const orderedCategoryNames = recCategoriesCache.map((c) => c.name).filter((name) => groups.has(name));
  groups.forEach((_, key) => {
    if (!orderedCategoryNames.includes(key)) orderedCategoryNames.push(key);
  });

  orderedCategoryNames.forEach((categoryName) => {
    const recipesInGroup = groups.get(categoryName);
    const bodyId = `recipe-group-body-${slugifyForId(categoryName)}`;

    const groupDiv = document.createElement('div');
    groupDiv.className = 'recipe-category-group';
    groupDiv.innerHTML = `
      <button type="button" class="recipe-group-header" data-target-id="${bodyId}">
        <span class="group-toggle-icon">▾</span> 🏷️ ${categoryName} (${recipesInGroup.length})
      </button>
      <div id="${bodyId}" class="recipe-group-body"></div>
    `;
    recipeList.appendChild(groupDiv);

    const bodyContainer = groupDiv.querySelector('.recipe-group-body');
    recipesInGroup.forEach((rec) => renderRecipeCard(rec, bodyContainer));
  });
}

document.addEventListener('click', (e) => {
  const header = e.target.closest('.recipe-group-header');
  if (!header) return;
  const body = document.getElementById(header.dataset.targetId);
  if (!body) return;
  body.hidden = !body.hidden;
  header.querySelector('.group-toggle-icon').textContent = body.hidden ? '▸' : '▾';
});

// ==========================
// FUNGSI: Download file export (Excel/PDF) dengan Authorization header
// (tidak bisa pakai <a href> biasa karena butuh kirim token login)
// ==========================
async function downloadExport(url, filename, button) {
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = 'Memproses...';

  try {
    const res = await apiFetch(url);
    if (!res.ok) {
      const result = await res.json().catch(() => ({}));
      throw new Error(result.error || 'Gagal mengunduh file');
    }
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
}

exportRecipesExcelBtn.addEventListener('click', () => {
  downloadExport(`${API_URL}/reports/recipes/export/excel`, 'laporan-hpp-resep.xlsx', exportRecipesExcelBtn);
});

exportRecipesPdfBtn.addEventListener('click', () => {
  downloadExport(`${API_URL}/reports/recipes/export/pdf`, 'laporan-hpp-resep.pdf', exportRecipesPdfBtn);
});

exportIngredientsExcelBtn.addEventListener('click', () => {
  downloadExport(`${API_URL}/reports/ingredients/export/excel`, 'daftar-bahan-baku.xlsx', exportIngredientsExcelBtn);
});

const exportBackupBtn = document.getElementById('exportBackupBtn');
exportBackupBtn.addEventListener('click', () => {
  const today = new Date().toISOString().slice(0, 10);
  downloadExport(`${API_URL}/backup/export`, `food-cost-backup-${today}.json`, exportBackupBtn);
});

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
function renderRecipeCard(recipe, container = recipeList) {
  const div = document.createElement('div');
  div.className = 'recipe-item';

  const ingredientListHtml = recipe.ingredients.map(ing => {
    const displayUnit = ing.used_unit || ing.unit;
    return `
      <li>
        <span>${ing.name} — ${ing.quantity_used} ${displayUnit} (Rp${Number(ing.price_per_unit).toLocaleString('id-ID')}/${ing.unit})</span>
        <button type="button" class="ri-edit-btn" data-recipe-id="${recipe.id}" data-ri-id="${ing.recipe_ingredient_id}" data-ingredient-id="${ing.ingredient_id}" data-qty="${ing.quantity_used}" data-unit="${displayUnit}" data-name="${ing.name}" title="Edit bahan ini">✏️</button>
        <button type="button" class="ri-delete-btn" data-recipe-id="${recipe.id}" data-ri-id="${ing.recipe_ingredient_id}" title="Hapus bahan ini dari resep">🗑️</button>
      </li>
    `;
  }).join('');

  const hasPercentage = recipe.food_cost_percentage !== null;
  const badgeColor = hasPercentage ? getBadgeColor(recipe.food_cost_percentage) : '#888';
  const badgeText = hasPercentage ? `${recipe.food_cost_percentage}%` : 'N/A';

  const overTargetHtml = recipe.over_target
    ? `<div class="over-target-alert">⚠️ Melebihi target food cost (${recipe.target_food_cost_percent}%)</div>`
    : '';

  const ingredientCount = recipe.ingredients.length;
  const detailListId = `ri-detail-${recipe.id}`;

  div.innerHTML = `
    <h3>${recipe.name} (ID: ${recipe.id})</h3>
    ${recipe.category ? `<p class="target-info">🏷️ ${recipe.category}</p>` : ''}
    <p>Harga Jual: Rp${Number(recipe.selling_price).toLocaleString('id-ID')} | Porsi: ${recipe.portion_yield}</p>
    <p><strong>HPP Total:</strong> Rp${Number(recipe.hpp_total).toLocaleString('id-ID')}</p>
    <p><strong>HPP per Porsi:</strong> Rp${Number(recipe.hpp_per_portion).toLocaleString('id-ID')}</p>
    <p class="food-cost-badge" style="background-color: ${badgeColor};"><strong>Food Cost:</strong> ${badgeText}</p>
    <p class="target-info">Target Food Cost: ${recipe.target_food_cost_percent}%</p>
    ${overTargetHtml}
    <button type="button" class="toggle-ri-detail-btn" data-target-id="${detailListId}">🔍 Lihat Rincian Bahan (${ingredientCount})</button>
    <ul id="${detailListId}" class="ri-detail-list" hidden>${ingredientListHtml || '<li><em>Belum ada bahan</em></li>'}</ul>
    <div class="form-actions" style="margin-top: 10px;">
      <button class="edit-btn" data-id="${recipe.id}" data-type="recipe">✏️ Edit</button>
      <button class="delete-btn" data-id="${recipe.id}" data-type="recipe">🗑️ Hapus Resep</button>
    </div>
  `;

  container.appendChild(div);
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
  ingSupplierSelect.value = ing.supplier_id || '';
  ingCategorySelect.value = ing.category || '';

  const isBasedProduct = Boolean(ing.source_recipe_id);
  ingIsBasedProduct.checked = isBasedProduct;
  toggleBasedProductFields(isBasedProduct);
  if (isBasedProduct) {
    ingSourceRecipeSelect.value = ing.source_recipe_id;
    ingYieldQuantityInput.value = ing.yield_quantity;
  } else {
    // harga 0 = belum diisi: biarkan kosong supaya placeholder terlihat
    document.getElementById('ingPrice').value = Number(ing.price_per_unit) > 0 ? ing.price_per_unit : '';
  }

  expandCollapse('ingredientForm'); // form harus terlihat saat mengedit
  ingFormTitle.textContent = 'Edit Bahan Baku';
  ingSubmitBtn.textContent = 'Update Bahan';
  ingCancelBtn.style.display = 'inline-block';
  ingredientForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditIngredient() {
  ingredientForm.reset();
  document.getElementById('ingId').value = '';
  toggleBasedProductFields(false);
  ingFormTitle.textContent = 'Tambah Bahan Baku';
  ingSubmitBtn.textContent = 'Tambah Bahan';
  ingCancelBtn.style.display = 'none';
}

ingCancelBtn.addEventListener('click', cancelEditIngredient);

// ==========================
// EDIT MODE: Recipe
// ==========================
function startEditRecipe(rec) {
  switchTab('recipe'); // form-nya ada di tab Resep, bukan di tab Daftar Resep tempat tombol Edit diklik
  document.getElementById('recId').value = rec.id;
  document.getElementById('recName').value = rec.name;
  document.getElementById('recPrice').value = rec.selling_price;
  document.getElementById('recPortion').value = rec.portion_yield;
  recTargetPercent.value = rec.target_food_cost_percent || '';
  recCategorySelect.value = rec.category || '';
  toggleRecipeYieldFields();
  recYieldQuantityInput.value = rec.yield_quantity || '';
  if (rec.yield_unit) recYieldUnitSelect.value = rec.yield_unit;
  recFormTitle.textContent = 'Edit Resep';
  recSubmitBtn.textContent = 'Update Resep';
  recCancelBtn.style.display = 'inline-block';
  recipeForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

function cancelEditRecipe() {
  recipeForm.reset();
  document.getElementById('recId').value = '';
  toggleRecipeYieldFields();
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
  const isBasedProduct = ingIsBasedProduct.checked;
  const source_recipe_id = isBasedProduct ? ingSourceRecipeSelect.value : null;
  const yield_quantity = isBasedProduct ? ingYieldQuantityInput.value : null;

  if (!name || !unit) {
    showToast('Nama dan satuan tidak boleh kosong');
    return;
  }
  if (isBasedProduct) {
    if (!source_recipe_id) {
      showToast('Pilih resep sumber untuk bahan olahan ini');
      return;
    }
    if (yield_quantity === '' || isNaN(Number(yield_quantity)) || Number(yield_quantity) <= 0) {
      showToast('Jumlah hasil (yield) harus berupa angka lebih dari 0');
      return;
    }
  } else if (price_per_unit !== '' && (isNaN(Number(price_per_unit)) || Number(price_per_unit) < 0)) {
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
      body: JSON.stringify({
        name,
        unit,
        price_per_unit: isBasedProduct ? 0 : price_per_unit,
        supplier_id: supplier_id || null,
        category,
        source_recipe_id: source_recipe_id || null,
        yield_quantity: yield_quantity || null
      })
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

  const isBasedProductCategory = isSelectedRecipeCategoryBasedProduct();
  const yield_quantity = recYieldQuantityInput.value;
  const yield_unit = recYieldUnitSelect.value;
  if (isBasedProductCategory && (yield_quantity === '' || isNaN(Number(yield_quantity)) || Number(yield_quantity) <= 0)) {
    showToast('Jumlah hasil (yield) harus berupa angka lebih dari 0');
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
        category: recCategorySelect.value || null,
        yield_quantity: isBasedProductCategory ? yield_quantity : null,
        yield_unit: isBasedProductCategory ? yield_unit : null
      })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || `Gagal ${isEdit ? 'mengupdate' : 'menambah'} resep`);

    cancelEditRecipe();
    loadRecipes();
    loadRecipeDropdown();
    loadMenuList();
    loadDashboard();
    loadIngredients();
    loadIngredientDropdown();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

// ==========================
// MODAL: Edit 1 bahan yang sudah ada di resep (dipicu tombol ✏️ di kartu resep)
// ==========================
function openEditRiModal(recipeId, riId, ingredientId, qty, unit, ingredientName) {
  document.getElementById('editRiRecipeId').value = recipeId;
  document.getElementById('editRiId').value = riId;
  document.getElementById('editRiIngredientName').textContent = ingredientName;
  document.getElementById('editRiQty').value = qty;

  const ing = allIngredientsCache.find(i => i.id === Number(ingredientId));
  const unitSelectEl = document.getElementById('editRiUnit');
  unitSelectEl.innerHTML = ing
    ? getCompatibleUnits(ing.unit).map(u => `<option value="${u}">${u}</option>`).join('')
    : defaultUnitOptionsHtml();
  unitSelectEl.value = normalizeUnit(unit) || unit;

  editRiModalOverlay.style.display = 'flex';
}

editRiModalCloseBtn.addEventListener('click', () => { editRiModalOverlay.style.display = 'none'; });
editRiModalOverlay.addEventListener('click', (e) => {
  if (e.target === editRiModalOverlay) editRiModalOverlay.style.display = 'none';
});

editRiForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const recipeId = document.getElementById('editRiRecipeId').value;
  const riId = document.getElementById('editRiId').value;
  const quantity_used = document.getElementById('editRiQty').value;
  const unit = document.getElementById('editRiUnit').value;

  if (quantity_used === '' || isNaN(Number(quantity_used)) || Number(quantity_used) <= 0) {
    showToast('Jumlah dipakai harus berupa angka lebih dari 0');
    return;
  }

  try {
    const res = await apiFetch(`${API_URL}/recipes/${recipeId}/ingredients/${riId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ quantity_used, unit })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal mengupdate bahan di resep');

    editRiModalOverlay.style.display = 'none';
    loadRecipes();
    loadDashboard();
    showToast('Bahan di resep berhasil diupdate', 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

async function handleDeleteRecipeIngredient(recipeId, riId) {
  const confirmDelete = confirm('Yakin ingin menghapus bahan ini dari resep?');
  if (!confirmDelete) return;

  try {
    const res = await apiFetch(`${API_URL}/recipes/${recipeId}/ingredients/${riId}`, { method: 'DELETE' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menghapus bahan dari resep');

    loadRecipes();
    loadDashboard();
    showToast('Bahan berhasil dihapus dari resep', 'success');
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
}

document.addEventListener('click', (e) => {
  if (e.target.classList.contains('ri-edit-btn')) {
    const d = e.target.dataset;
    openEditRiModal(d.recipeId, d.riId, d.ingredientId, d.qty, d.unit, d.name);
  }
  if (e.target.classList.contains('ri-delete-btn')) {
    handleDeleteRecipeIngredient(e.target.dataset.recipeId, e.target.dataset.riId);
  }
  if (e.target.classList.contains('toggle-ri-detail-btn')) {
    const list = document.getElementById(e.target.dataset.targetId);
    if (!list) return;
    list.hidden = !list.hidden;
    const count = list.querySelectorAll('li').length;
    e.target.textContent = list.hidden ? `🔍 Lihat Rincian Bahan (${count})` : '🔼 Sembunyikan Rincian Bahan';
  }
});

// ==========================
// EVENT: Simpan semua baris bahan sekaligus ke resep yang dipilih
// ==========================
multiIngredientForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const recipeId = recipeSelect.value;
  if (!recipeId) {
    showToast('Pilih resep terlebih dahulu!');
    return;
  }

  const rows = Array.from(multiIngredientRows.querySelectorAll('tr'));
  const filledRows = [];
  for (const row of rows) {
    const ingredientId = row.querySelector('.mi-ingredient').value;
    const qty = row.querySelector('.mi-qty').value;
    const unit = row.querySelector('.mi-unit').value;

    if (!ingredientId && qty === '') continue; // baris kosong, lewati saja

    if (!ingredientId) {
      showToast('Ada baris yang belum dipilih bahannya');
      return;
    }
    if (qty === '' || isNaN(Number(qty)) || Number(qty) <= 0) {
      showToast('Jumlah dipakai harus berupa angka lebih dari 0 di semua baris yang diisi');
      return;
    }
    filledRows.push({ ingredient_id: ingredientId, quantity_used: qty, unit });
  }

  if (filledRows.length === 0) {
    showToast('Isi minimal 1 baris bahan');
    return;
  }

  let successCount = 0;
  const errors = [];
  for (const row of filledRows) {
    try {
      const res = await apiFetch(`${API_URL}/recipes/${recipeId}/ingredients`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(row)
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menambah bahan');
      successCount++;
    } catch (err) {
      const ing = allIngredientsCache.find(i => i.id === Number(row.ingredient_id));
      errors.push(`${ing ? ing.name : 'Bahan'}: ${err.message}`);
    }
  }

  loadRecipes();
  loadDashboard();

  if (errors.length === 0) {
    // Sengaja tidak reset recipeSelect supaya bisa langsung isi baris baru untuk resep yang sama
    resetMultiIngredientRows();
    showToast(`${successCount} bahan berhasil ditambahkan ke resep`, 'success');
  } else if (successCount > 0) {
    showToast(`${successCount} bahan berhasil, ${errors.length} gagal — ${errors.join('; ')}`);
  } else {
    showToast(`Gagal menambahkan bahan — ${errors.join('; ')}`);
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
  renderGroupedRecipeList();
}, 300));

recFilterCategory.addEventListener('change', (e) => {
  recFilterCategoryValue = e.target.value;
  renderGroupedRecipeList();
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
// FOOD INVENTORY: daftar item sendiri, stok masuk/keluar, stock opname, nilai stok
// ==========================
const invSummaryEl = document.getElementById('invSummary');
const invMoveForm = document.getElementById('invMoveForm');
const invMoveItem = document.getElementById('invMoveItem');
const invMoveQty = document.getElementById('invMoveQty');
const invMoveNote = document.getElementById('invMoveNote');
const invMovePreview = document.getElementById('invMovePreview');
const invMoveSubmitBtn = document.getElementById('invMoveSubmitBtn');
const invItemForm = document.getElementById('invItemForm');
const invFormTitle = document.getElementById('invFormTitle');
const invItemSubmitBtn = document.getElementById('invItemSubmitBtn');
const invItemCancelBtn = document.getElementById('invItemCancelBtn');
const invItemOpening = document.getElementById('invItemOpening');
const invItemTableBody = document.querySelector('#invItemTable tbody');
const invItemTableFoot = document.querySelector('#invItemTable tfoot');
const invSearchInput = document.getElementById('invSearchInput');
const invFilterCategory = document.getElementById('invFilterCategory');
const invHistoryType = document.getElementById('invHistoryType');
const invHistoryItem = document.getElementById('invHistoryItem');
const invHistoryTableBody = document.querySelector('#invHistoryTable tbody');

let invItemsCache = [];
let invMoveType = 'in';
const INV_TYPE_LABEL = { in: 'Stok Masuk', out: 'Stok Keluar', opname: 'Stock Opname' };

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const fmtQty = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 });
const fmtRp = (n) => 'Rp' + Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 0 });
// Waktu dari database disimpan dalam UTC; tampilkan dalam jam lokal
function fmtInvTime(value) {
  if (!value) return '-';
  const s = String(value);
  const d = new Date(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
  return isNaN(d) ? s : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
}

async function loadInventory() {
  try {
    const res = await apiFetch(`${API_URL}/inventory/items`);
    const items = await res.json();
    if (!res.ok) throw new Error(items.error || 'Gagal memuat inventory');
    invItemsCache = items;
    renderInventorySummary();
    renderInventoryDropdowns();
    applyInventoryFilter();
    updateInvMovePreview();
  } catch (err) {
    console.error('Gagal memuat inventory:', err);
  }
  loadInventoryHistory();
}

function renderInventorySummary() {
  const total = invItemsCache.reduce((sum, it) => sum + Number(it.value || 0), 0);
  const empty = invItemsCache.filter((it) => Number(it.stock) <= 0).length;
  const cats = new Set(invItemsCache.map((it) => it.category).filter(Boolean)).size;
  invSummaryEl.innerHTML = `
    <div class="stat-card"><div class="stat-value">${fmtRp(total)}</div><div class="stat-label">Total Nilai Stok</div></div>
    <div class="stat-card"><div class="stat-value">${invItemsCache.length}</div><div class="stat-label">Total Item</div></div>
    <div class="stat-card"><div class="stat-value">${cats}</div><div class="stat-label">Kategori</div></div>
    <div class="stat-card"><div class="stat-value"${empty ? ' style="color:#b71c1c"' : ''}>${empty}</div><div class="stat-label">Stok Habis</div></div>
  `;
}

function renderInventoryDropdowns() {
  const options = invItemsCache.map((it) => `<option value="${it.id}">${escapeHtml(it.name)} (stok ${fmtQty(it.stock)} ${escapeHtml(it.unit)})</option>`).join('');
  const keepMove = invMoveItem.value;
  invMoveItem.innerHTML = '<option value="">Pilih Item</option>' + options;
  if (invItemsCache.some((it) => String(it.id) === keepMove)) invMoveItem.value = keepMove;

  const keepHist = invHistoryItem.value;
  invHistoryItem.innerHTML = '<option value="">Semua Item</option>' + invItemsCache.map((it) => `<option value="${it.id}">${escapeHtml(it.name)}</option>`).join('');
  if (invItemsCache.some((it) => String(it.id) === keepHist)) invHistoryItem.value = keepHist;

  const cats = [...new Set(invItemsCache.map((it) => (it.category || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'id'));
  const keepCat = invFilterCategory.value;
  invFilterCategory.innerHTML = '<option value="">Semua Kategori</option>' + cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  if (cats.includes(keepCat)) invFilterCategory.value = keepCat;
  document.getElementById('invCategoryList').innerHTML = cats.map((c) => `<option value="${escapeHtml(c)}"></option>`).join('');
}

function applyInventoryFilter() {
  const term = invSearchInput.value.trim().toLowerCase();
  const cat = invFilterCategory.value;
  const rows = invItemsCache.filter((it) =>
    (!term || it.name.toLowerCase().includes(term)) && (!cat || (it.category || '') === cat)
  );
  const isAdmin = currentUser && currentUser.role === 'admin';
  invItemTableBody.innerHTML = rows.map((it) => `
    <tr>
      <td>${escapeHtml(it.name)}</td>
      <td>${escapeHtml(it.category || '-')}</td>
      <td class="num${Number(it.stock) <= 0 ? ' inv-empty' : ''}">${fmtQty(it.stock)}</td>
      <td>${escapeHtml(it.unit)}</td>
      <td class="num">${fmtRp(it.price_per_unit)}</td>
      <td class="num">${fmtRp(it.value)}</td>
      <td>
        <button type="button" class="edit-btn" data-inv-edit="${it.id}">✏️ Edit</button>
        ${isAdmin ? `<button type="button" class="delete-btn" data-inv-delete="${it.id}">🗑️ Hapus</button>` : ''}
      </td>
    </tr>`).join('') || '<tr><td colspan="7"><em>Belum ada item. Tambahkan lewat form "Tambah Item" di atas.</em></td></tr>';
  const total = rows.reduce((sum, it) => sum + Number(it.value || 0), 0);
  invItemTableFoot.innerHTML = rows.length
    ? `<tr><td colspan="5">Total nilai stok${cat || term ? ' (sesuai filter)' : ''}</td><td class="num">${fmtRp(total)}</td><td></td></tr>`
    : '';
}

async function loadInventoryHistory() {
  try {
    const params = new URLSearchParams({ limit: '200' });
    if (invHistoryType.value) params.set('type', invHistoryType.value);
    if (invHistoryItem.value) params.set('item_id', invHistoryItem.value);
    const res = await apiFetch(`${API_URL}/inventory/movements?${params}`);
    const rows = await res.json();
    if (!res.ok) throw new Error(rows.error || 'Gagal memuat riwayat');
    const isAdmin = currentUser && currentUser.role === 'admin';
    invHistoryTableBody.innerHTML = rows.map((m) => {
      const sign = m.type === 'in' ? '+' : m.type === 'out' ? '−' : '';
      const diff = m.type === 'opname' && m.difference !== null && m.difference !== undefined
        ? `<span class="${Number(m.difference) < 0 ? 'inv-diff-minus' : 'inv-diff-plus'}">${Number(m.difference) > 0 ? '+' : ''}${fmtQty(m.difference)}</span>`
        : '-';
      return `
      <tr>
        <td>${fmtInvTime(m.created_at)}</td>
        <td>${escapeHtml(m.item_name)}</td>
        <td><span class="inv-badge ${m.type}">${INV_TYPE_LABEL[m.type] || m.type}</span></td>
        <td class="num">${sign}${fmtQty(m.quantity)} ${escapeHtml(m.item_unit)}</td>
        <td class="num">${diff}</td>
        <td class="num">${fmtQty(m.stock_after)}</td>
        <td>${escapeHtml(m.note || '-')}</td>
        <td>${escapeHtml(m.created_by || '-')}</td>
        <td class="admin-only-block">${isAdmin ? `<button type="button" class="delete-btn" data-inv-move-delete="${m.id}" title="Hapus transaksi ini; stok dihitung ulang">🗑️</button>` : ''}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="9"><em>Belum ada riwayat stok.</em></td></tr>';
  } catch (err) {
    console.error('Gagal memuat riwayat inventory:', err);
  }
}

function setInvMoveType(type) {
  invMoveType = type;
  document.querySelectorAll('.inv-type-btn').forEach((b) => b.classList.toggle('active', b.dataset.type === type));
  invMoveQty.placeholder = type === 'opname' ? 'Hasil hitung fisik (stok sebenarnya)' : 'Jumlah';
  invMoveSubmitBtn.textContent = `Simpan ${INV_TYPE_LABEL[type]}`;
  updateInvMovePreview();
}

function updateInvMovePreview() {
  const it = invItemsCache.find((x) => String(x.id) === invMoveItem.value);
  if (!it) { invMovePreview.textContent = ''; return; }
  const cur = Number(it.stock) || 0;
  const qtyRaw = invMoveQty.value;
  let text = `Stok sekarang: ${fmtQty(cur)} ${it.unit}`;
  if (qtyRaw !== '' && !isNaN(Number(qtyRaw))) {
    const q = Number(qtyRaw);
    if (invMoveType === 'opname') {
      const d = q - cur;
      text += ` → hasil hitung ${fmtQty(q)} ${it.unit} (selisih ${d > 0 ? '+' : ''}${fmtQty(d)}, nilai ${fmtRp(d * Number(it.price_per_unit || 0))})`;
    } else {
      const after = invMoveType === 'in' ? cur + q : cur - q;
      text += ` → setelah disimpan: ${fmtQty(after)} ${it.unit}`;
      if (after < 0) text += ' ⚠️ stok tidak cukup';
    }
  }
  invMovePreview.textContent = text;
}

document.querySelectorAll('.inv-type-btn').forEach((b) => b.addEventListener('click', () => setInvMoveType(b.dataset.type)));
invMoveItem.addEventListener('change', updateInvMovePreview);
invMoveQty.addEventListener('input', updateInvMovePreview);
invSearchInput.addEventListener('input', debounce(applyInventoryFilter, 200));
invFilterCategory.addEventListener('change', applyInventoryFilter);
invHistoryType.addEventListener('change', loadInventoryHistory);
invHistoryItem.addEventListener('change', loadInventoryHistory);

invMoveForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const item = invItemsCache.find((x) => String(x.id) === invMoveItem.value);
  try {
    const res = await apiFetch(`${API_URL}/inventory/movements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_id: invMoveItem.value, type: invMoveType, quantity: invMoveQty.value, note: invMoveNote.value })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menyimpan');
    const name = item ? item.name : 'Item';
    showToast(invMoveType === 'opname'
      ? `Stock opname ${name} disimpan (selisih ${result.difference > 0 ? '+' : ''}${fmtQty(result.difference)})`
      : `${INV_TYPE_LABEL[invMoveType]} ${name} disimpan, stok sekarang ${fmtQty(result.stock)}`, 'success');
    invMoveQty.value = '';
    invMoveNote.value = '';
    loadInventory();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

function resetInvItemForm() {
  invItemForm.reset();
  document.getElementById('invItemId').value = '';
  invFormTitle.textContent = 'Tambah Item';
  invItemSubmitBtn.textContent = 'Tambah Item';
  invItemCancelBtn.style.display = 'none';
  invItemOpening.style.display = '';
}

invItemCancelBtn.addEventListener('click', resetInvItemForm);

document.getElementById('invImportBtn').addEventListener('click', async (e) => {
  if (!confirm('Salin semua bahan baku ke Food Inventory?\nNama, kategori, satuan & harga ikut disalin, stok mulai dari 0. Bahan yang namanya sudah ada di inventory dilewati.')) return;
  const btn = e.currentTarget;
  btn.disabled = true;
  try {
    const res = await apiFetch(`${API_URL}/inventory/items/import-from-ingredients`, { method: 'POST' });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menyalin bahan baku');
    showToast(`${result.added} bahan baku disalin ke inventory` + (result.skipped ? ` (${result.skipped} dilewati karena sudah ada)` : ''), 'success');
    loadInventory();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
  btn.disabled = false;
});

invItemForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('invItemId').value;
  const body = {
    name: document.getElementById('invItemName').value,
    category: document.getElementById('invItemCategory').value,
    unit: document.getElementById('invItemUnit').value,
    price_per_unit: document.getElementById('invItemPrice').value,
    opening_stock: id ? undefined : invItemOpening.value
  };
  try {
    const res = await apiFetch(`${API_URL}/inventory/items${id ? '/' + id : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Gagal menyimpan item');
    showToast(id ? 'Item diperbarui' : `Item "${body.name.trim()}" ditambahkan`, 'success');
    resetInvItemForm();
    loadInventory();
  } catch (err) {
    showToast('Terjadi kesalahan: ' + err.message);
  }
});

document.addEventListener('click', async (e) => {
  const edit = e.target.closest('[data-inv-edit]');
  const del = e.target.closest('[data-inv-delete]');
  const delMove = e.target.closest('[data-inv-move-delete]');

  if (edit) {
    const it = invItemsCache.find((x) => String(x.id) === edit.dataset.invEdit);
    if (!it) return;
    document.getElementById('invItemId').value = it.id;
    document.getElementById('invItemName').value = it.name;
    document.getElementById('invItemCategory').value = it.category || '';
    document.getElementById('invItemUnit').value = it.unit;
    document.getElementById('invItemPrice').value = it.price_per_unit;
    invItemOpening.value = '';
    invItemOpening.style.display = 'none'; // stok diubah lewat Catat Stok / Stock Opname
    invFormTitle.textContent = `Edit Item: ${it.name}`;
    invItemSubmitBtn.textContent = 'Update Item';
    invItemCancelBtn.style.display = '';
    invItemForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  if (del) {
    const it = invItemsCache.find((x) => String(x.id) === del.dataset.invDelete);
    if (!it || !confirm(`Hapus item "${it.name}" beserta seluruh riwayat stoknya?`)) return;
    try {
      const res = await apiFetch(`${API_URL}/inventory/items/${it.id}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menghapus item');
      showToast(`Item "${it.name}" dihapus`, 'success');
      loadInventory();
    } catch (err) {
      showToast('Terjadi kesalahan: ' + err.message);
    }
    return;
  }

  if (delMove) {
    if (!confirm('Hapus transaksi ini? Stok item akan dihitung ulang.')) return;
    try {
      const res = await apiFetch(`${API_URL}/inventory/movements/${delMove.dataset.invMoveDelete}`, { method: 'DELETE' });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || 'Gagal menghapus transaksi');
      showToast('Transaksi dihapus, stok dihitung ulang', 'success');
      loadInventory();
    } catch (err) {
      showToast('Terjadi kesalahan: ' + err.message);
    }
  }
});

// ==========================
// INISIALISASI: Jalankan saat halaman dimuat
// ==========================
async function startApp() {
  hideLoginOverlay();
  renderUserBar();
  switchTab('dashboard');
  resetMultiIngredientRows();

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
    loadUsers(),
    loadInventory()
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

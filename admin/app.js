/**
 * ADMIN PANEL — Toyota Auto2000 Rantauprapat
 * Frontend JavaScript (Vanilla)
 */

// ==================== STATE ====================
let currentPage = 'dashboard';
let dataPage = 1;
let searchTimeout = null;
let importData = null;
let selectedBrochureFile = null;
let csrfToken = sessionStorage.getItem('csrf_token') || '';


// Sample data dari Toyota New Alphard 2.5 XE
const SAMPLE_DATA = {
    tipe_mobil: "Toyota New Alphard",
    varian: "2.5 XE (Gasoline)",
    harga: "1.355.000.000",
    est_bbm_kota: "7 km/l",
    est_bbm_tol: "10 km/l",
    spesifikasi: {
        segmentation: "MPV Premium / Luxury Minivan",
        performance_specs: "Ditenagai mesin bensin 2AR FE berkapasitas 2.5L. Menghasilkan tenaga maksimal 134 KW (182 PS) dan torsi 235 Nm (23.9 kgm). Menggunakan transmisi CVT dengan mode Sequential [M Mode].",
        fuel_system_capacity_efficiency_estimates: "Berbahan bakar bensin. Kapasitas tangki 75 liter dan estimasi konsumsi bahan bakar dalam kota yang padat, konsumsi ini biasanya turun menjadi sekitar 7 hingga 9 km per liter, sedangkan untuk perjalanan luar kota atau tol dapat mencapai sekitar 10 hingga 12 km per liter.",
        dimensions: "Panjang 5.010 mm, lebar 1.850 mm, tinggi 1.945 mm, dan jarak sumbu roda 3.000 mm. Kapasitas penumpang adalah 7 orang (2 di depan, 2 Captain Seat di baris kedua, dan 3 penumpang di baris ketiga).",
        colour_option: "Black, Platinum White Pearl.",
        chassis_drivetrain: "Sistem kemudi Power Tilt & Telescopic. Suspensi depan FR Strut dan suspensi belakang Double Wishbone (DWB). Menggunakan velg Alloy 17 inci dengan ban 225/65 R17.",
        exterior: "Dilengkapi Luxury Front Grille, Sharp LED Headlamp (LED 3 Lamps, Adaptive High beam System, Cornering Lamp, Sequential Turn Lamp, dan DRL), Elegant Rear Combination Lamp, serta Comfortable Power Slide Door.",
        interior_comfort: "Material jok berbahan Synthetic Leather. Baris kedua menggunakan Captain Seat berpengaturan elektrik (Power) dengan Headrest besar. Baris ketiga berupa 5:5 Split Space up Bench. Sistem tata udara Dual A/C dengan Nanoe X untuk area depan (FR). Terdapat Rear Side Shade dan Front Seat Storage.",
        technology: "Panel instrumen pengemudi 12.3 inci Full TFT Digital Meter. Head Unit 14 inci yang dipadukan 15 speaker JBL, Rear Seat Entertainment 14 inci, tombol kemudi Audio+Voice+ACC+LTA, dan Wireless Charger.",
        safety_specs: "Toyota Safety Sense 3.0 (Pre Collision System, Full Speed ACC, Lane Tracing Assist, Adaptive High Beam, Dynamic Radar Cruise Control, Lane Departure Alert). Dilengkapi Panoramic View Monitor (PVM), Blind Spot Monitor (BSM), Parking Brake Support (mendeteksi Object+Vehicle+Pedestrian), Safe Exit Assist (SEA), dan Airbags (Front D+P, Side, CSA)."
    }
};

// ==================== INIT ====================
document.addEventListener('DOMContentLoaded', () => {
    // Fetch CSRF token jika belum ada
    if (!csrfToken) {
        fetchCsrfToken();
    }
    loadStats();
    setupDragDrop();
    setupBrochureDragDrop();
});

async function fetchCsrfToken() {
    try {
        const res = await fetch('/api/csrf-token');
        if (res.ok) {
            const data = await res.json();
            csrfToken = data.csrf_token;
            sessionStorage.setItem('csrf_token', csrfToken);
        } else if (res.status === 401) {
            window.location.href = '/login';
        }
    } catch (e) {
        console.error('Failed to fetch CSRF token:', e);
    }
}

// ==================== API HELPERS ====================
async function apiGet(url) {
    const res = await fetch(url);
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return res.json();
}

async function apiPost(url, body, isFormData = false) {
    const headers = { 'X-CSRF-Token': csrfToken };
    let fetchBody;

    if (isFormData) {
        fetchBody = body;
        // Don't set Content-Type for FormData
    } else {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
    }

    const res = await fetch(url, { method: 'POST', headers, body: fetchBody });
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return { status: res.status, data: await res.json() };
}

async function apiPut(url, body) {
    const res = await fetch(url, {
        method: 'PUT',
        headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrfToken
        },
        body: JSON.stringify(body)
    });
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return { status: res.status, data: await res.json() };
}

async function apiDelete(url) {
    const res = await fetch(url, {
        method: 'DELETE',
        headers: { 'X-CSRF-Token': csrfToken }
    });
    if (res.status === 401) {
        window.location.href = '/login';
        throw new Error('Unauthorized');
    }
    return { status: res.status, data: await res.json() };
}

// ==================== NAVIGATION ====================
function toggleMobileMenu() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && overlay) {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    }
}

function navigateTo(page) {
    // Tutup sidebar di mode mobile jika terbuka
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    if (sidebar && sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    }

    // Update nav
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    const navItem = document.querySelector(`.nav-item[data-page="${page}"]`);
    if (navItem) navItem.classList.add('active');

    // Update pages
    document.querySelectorAll('.page-section').forEach(el => el.classList.remove('active'));
    const pageEl = document.getElementById(`page-${page}`);
    if (pageEl) pageEl.classList.add('active');

    // Update header
    const titles = {
        dashboard: ['Dashboard', 'Ringkasan statistik database mobil Toyota'],
        data: ['Data Mobil', 'Kelola semua data mobil di database TiDB'],
        tambah: ['Tambah Data', 'Tambah data mobil baru ke database'],
        import: ['Import JSON', 'Import data mobil dari file JSON'],
        ekstrak: ['Ekstrak Brosur AI', 'Upload foto/PDF brosur resmi Toyota untuk diekstrak otomatis']
    };
    const [title, desc] = titles[page] || ['', ''];
    document.getElementById('pageTitle').textContent = title;
    document.getElementById('pageDesc').textContent = desc;

    currentPage = page;

    // Load data jika diperlukan
    if (page === 'dashboard') loadStats();
    if (page === 'data') loadData();
}

// ==================== DASHBOARD ====================
async function loadStats() {
    try {
        const data = await apiGet('/api/stats');
        document.getElementById('statTotal').textContent = data.total_data.toLocaleString('id-ID');
        document.getElementById('statTipe').textContent = data.total_tipe.toLocaleString('id-ID');
        document.getElementById('statTime').textContent = new Date().toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit'
        });

        // Top models
        const container = document.getElementById('topModelsContainer');
        if (data.top_models && data.top_models.length > 0) {
            container.innerHTML = data.top_models.map((m, i) => `
                <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border); ${i === data.top_models.length - 1 ? 'border-bottom: none;' : ''}">
                    <div style="display: flex; align-items: center; gap: 12px;">
                        <span style="width: 28px; height: 28px; display: flex; align-items: center; justify-content: center; background: var(--accent-light); border-radius: 8px; font-size: 12px; font-weight: 700; color: var(--accent);">${i + 1}</span>
                        <span style="font-size: 13px; font-weight: 500;">${escapeHtml(m.tipe_mobil)}</span>
                    </div>
                    <span class="badge badge-accent">${m.jumlah} varian</span>
                </div>
            `).join('');
        } else {
            container.innerHTML = '<div class="empty-state"><p>Belum ada data.</p></div>';
        }
    } catch (e) {
        console.error('Load stats error:', e);
    }
}

// ==================== DATA TABLE ====================
async function loadData(page = 1) {
    dataPage = page;
    const search = document.getElementById('searchInput')?.value || '';
    const tbody = document.getElementById('dataTableBody');

    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="loading-spinner" style="margin: 0 auto 16px;"></div><p>Memuat data...</p></div></td></tr>`;

    try {
        const data = await apiGet(`/api/data?page=${page}&per_page=15&search=${encodeURIComponent(search)}`);

        if (data.data.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">🔍</div><h3>Data tidak ditemukan</h3><p>Coba ubah kata kunci pencarian Anda</p></div></td></tr>`;
            document.getElementById('paginationInfo').textContent = '0 data';
            document.getElementById('paginationControls').innerHTML = '';
            return;
        }

        tbody.innerHTML = data.data.map(car => `
            <tr>
                <td style="font-size: 12px; color: var(--text-muted); font-variant-numeric: tabular-nums;">${car.id}</td>
                <td class="cell-tipe">${escapeHtml(car.tipe_mobil)}</td>
                <td class="cell-varian">${escapeHtml(car.varian)}</td>
                <td class="cell-harga">Rp ${formatHarga(car.harga)}</td>
                <td class="cell-bbm">${car.bbm_kota} km/l</td>
                <td class="cell-bbm">${car.bbm_tol} km/l</td>
                <td>
                    <div class="cell-actions">
                        <button class="btn-icon view" onclick="viewDetail(${car.id})" title="Lihat Detail">👁</button>
                        <button class="btn-icon edit" onclick="openEditModal(${car.id})" title="Edit">✏️</button>
                        <button class="btn-icon danger" onclick="confirmDelete(${car.id}, '${escapeHtml(car.tipe_mobil)} ${escapeHtml(car.varian)}')" title="Hapus">🗑️</button>
                    </div>
                </td>
            </tr>
        `).join('');

        // Pagination
        const start = (data.page - 1) * data.per_page + 1;
        const end = Math.min(data.page * data.per_page, data.total);
        document.getElementById('paginationInfo').textContent = `Menampilkan ${start}-${end} dari ${data.total} data`;

        let paginationHtml = '';
        if (data.page > 1) {
            paginationHtml += `<button onclick="loadData(${data.page - 1})">← Prev</button>`;
        }
        for (let i = 1; i <= data.total_pages; i++) {
            if (i === 1 || i === data.total_pages || (i >= data.page - 2 && i <= data.page + 2)) {
                paginationHtml += `<button class="${i === data.page ? 'active' : ''}" onclick="loadData(${i})">${i}</button>`;
            } else if (i === data.page - 3 || i === data.page + 3) {
                paginationHtml += `<button disabled>...</button>`;
            }
        }
        if (data.page < data.total_pages) {
            paginationHtml += `<button onclick="loadData(${data.page + 1})">Next →</button>`;
        }
        document.getElementById('paginationControls').innerHTML = paginationHtml;

    } catch (e) {
        console.error('Load data error:', e);
        tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><div class="empty-icon">❌</div><h3>Gagal memuat data</h3><p>${escapeHtml(e.message)}</p></div></td></tr>`;
    }
}

function debounceSearch() {
    clearTimeout(searchTimeout);
    searchTimeout = setTimeout(() => loadData(1), 400);
}

// ==================== VIEW DETAIL ====================
async function viewDetail(id) {
    try {
        const car = await apiGet(`/api/data/${id}`);
        const spekFields = [
            ['Segmentation', 'segmentation'],
            ['Performance', 'performance_specs'],
            ['Fuel & Efficiency', 'fuel_system_capacity_efficiency_estimates'],
            ['Dimensions', 'dimensions'],
            ['Colour', 'colour_option'],
            ['Chassis & Drivetrain', 'chassis_drivetrain'],
            ['Exterior', 'exterior'],
            ['Interior & Comfort', 'interior_comfort'],
            ['Technology', 'technology'],
            ['Safety', 'safety_specs']
        ];

        const html = `
            <div class="modal-header">
                <h2>📋 Detail: ${escapeHtml(car.tipe_mobil)}</h2>
                <div class="modal-header-actions">
                    <button class="btn-back" style="margin-bottom:0;" onclick="closeModal()">⬅ Kembali</button>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
            </div>
            <div class="modal-body">
                <div class="detail-grid">
                    <div class="detail-row"><div class="detail-label">Tipe Mobil</div><div class="detail-value" style="font-weight:600;">${escapeHtml(car.tipe_mobil)}</div></div>
                    <div class="detail-row"><div class="detail-label">Varian</div><div class="detail-value">${escapeHtml(car.varian)}</div></div>
                    <div class="detail-row"><div class="detail-label">Harga</div><div class="detail-value" style="color:var(--success); font-weight:600;">Rp ${formatHarga(car.harga)}</div></div>
                    <div class="detail-row"><div class="detail-label">BBM Kota</div><div class="detail-value">${car.bbm_kota} km/l</div></div>
                    <div class="detail-row"><div class="detail-label">BBM Tol</div><div class="detail-value">${car.bbm_tol} km/l</div></div>
                    ${spekFields.map(([label, key]) => `
                        <div class="detail-row">
                            <div class="detail-label">${label}</div>
                            <div class="detail-value">${escapeHtml(car.spesifikasi?.[key] || '-')}</div>
                        </div>
                    `).join('')}
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Tutup</button>
                <button class="btn btn-primary" onclick="closeModal(); openEditModal(${id})">✏️ Edit Data Ini</button>
            </div>
        `;

        showModal(html);
    } catch (e) {
        showToast('Gagal memuat detail: ' + e.message, 'error');
    }
}

// ==================== EDIT MODAL ====================
async function openEditModal(id) {
    try {
        const car = await apiGet(`/api/data/${id}`);
        const spek = car.spesifikasi || {};

        const html = `
            <div class="modal-header">
                <h2>✏️ Edit: ${escapeHtml(car.tipe_mobil)} ${escapeHtml(car.varian)}</h2>
                <div class="modal-header-actions">
                    <button class="btn-back" style="margin-bottom:0;" onclick="closeModal()">⬅ Kembali</button>
                    <button class="modal-close" onclick="closeModal()">✕</button>
                </div>
            </div>
            <div class="modal-body">
                <div class="form-grid" style="margin-bottom: 16px;">
                    <div class="form-group">
                        <label>Tipe Mobil <span class="required">*</span></label>
                        <input type="text" id="edit_tipe_mobil" value="${escapeAttr(car.tipe_mobil)}">
                    </div>
                    <div class="form-group">
                        <label>Varian <span class="required">*</span></label>
                        <input type="text" id="edit_varian" value="${escapeAttr(car.varian)}">
                    </div>
                    <div class="form-group">
                        <label>Harga (OTR) <span class="required">*</span></label>
                        <input type="text" id="edit_harga" value="${formatHarga(car.harga)}">
                    </div>
                    <div class="form-group">
                        <label>Estimasi BBM Kota <span class="required">*</span></label>
                        <input type="text" id="edit_bbm_kota" value="${car.bbm_kota} km/l">
                    </div>
                    <div class="form-group">
                        <label>Estimasi BBM Tol <span class="required">*</span></label>
                        <input type="text" id="edit_bbm_tol" value="${car.bbm_tol} km/l">
                    </div>
                </div>
                
                <div style="font-size: 13px; font-weight: 600; margin: 20px 0 12px; display: flex; align-items: center; gap: 8px;">⚙️ Spesifikasi</div>
                
                <div style="display: grid; gap: 14px;">
                    <div class="form-group">
                        <label>Segmentation</label>
                        <textarea id="edit_segmentation" rows="2">${escapeHtml(spek.segmentation || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Performance Specs</label>
                        <textarea id="edit_performance_specs" rows="3">${escapeHtml(spek.performance_specs || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Fuel System & Efficiency</label>
                        <textarea id="edit_fuel_system" rows="3">${escapeHtml(spek.fuel_system_capacity_efficiency_estimates || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Dimensions</label>
                        <textarea id="edit_dimensions" rows="2">${escapeHtml(spek.dimensions || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Colour Option</label>
                        <textarea id="edit_colour_option" rows="2">${escapeHtml(spek.colour_option || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Chassis & Drivetrain</label>
                        <textarea id="edit_chassis" rows="3">${escapeHtml(spek.chassis_drivetrain || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Exterior</label>
                        <textarea id="edit_exterior" rows="3">${escapeHtml(spek.exterior || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Interior & Comfort</label>
                        <textarea id="edit_interior" rows="3">${escapeHtml(spek.interior_comfort || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Technology</label>
                        <textarea id="edit_technology" rows="3">${escapeHtml(spek.technology || '')}</textarea>
                    </div>
                    <div class="form-group">
                        <label>Safety Specs</label>
                        <textarea id="edit_safety" rows="3">${escapeHtml(spek.safety_specs || '')}</textarea>
                    </div>
                </div>
            </div>
            <div class="modal-footer">
                <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
                <button class="btn btn-primary" onclick="submitEdit(${id})" id="btnSubmitEdit">💾 Simpan Perubahan</button>
            </div>
        `;

        showModal(html);
    } catch (e) {
        showToast('Gagal memuat data untuk edit: ' + e.message, 'error');
    }
}

async function submitEdit(id) {
    const btn = document.getElementById('btnSubmitEdit');
    btn.disabled = true;
    btn.innerHTML = '⏳ Menyimpan & Re-embedding...';
    showLoading('Menyimpan perubahan & regenerasi embedding...');

    const body = {
        tipe_mobil: document.getElementById('edit_tipe_mobil').value,
        varian: document.getElementById('edit_varian').value,
        harga: document.getElementById('edit_harga').value,
        est_bbm_kota: document.getElementById('edit_bbm_kota').value,
        est_bbm_tol: document.getElementById('edit_bbm_tol').value,
        spesifikasi: {
            segmentation: document.getElementById('edit_segmentation').value,
            performance_specs: document.getElementById('edit_performance_specs').value,
            fuel_system_capacity_efficiency_estimates: document.getElementById('edit_fuel_system').value,
            dimensions: document.getElementById('edit_dimensions').value,
            colour_option: document.getElementById('edit_colour_option').value,
            chassis_drivetrain: document.getElementById('edit_chassis').value,
            exterior: document.getElementById('edit_exterior').value,
            interior_comfort: document.getElementById('edit_interior').value,
            technology: document.getElementById('edit_technology').value,
            safety_specs: document.getElementById('edit_safety').value
        }
    };

    try {
        const { status, data } = await apiPut(`/api/data/${id}`, body);
        hideLoading();

        if (status === 200 && data.success) {
            showToast(data.message, 'success');
            closeModal();
            if (currentPage === 'data') loadData(dataPage);
        } else {
            const errMsg = data.details ? data.details.join(', ') : data.error;
            showToast(errMsg, 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Gagal menyimpan: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Simpan Perubahan';
    }
}

// ==================== DELETE ====================
function confirmDelete(id, name) {
    const html = `
        <div class="modal-header">
            <h2>⚠️ Konfirmasi Hapus</h2>
            <button class="modal-close" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
            <div class="confirm-body">
                <div class="confirm-icon">🗑️</div>
                <h3>Hapus data ini?</h3>
                <p>Data <span class="highlight">${escapeHtml(name)}</span> akan dihapus permanen dari database. Aksi ini tidak bisa dibatalkan.</p>
            </div>
        </div>
        <div class="modal-footer">
            <button class="btn btn-secondary" onclick="closeModal()">Batal</button>
            <button class="btn btn-danger" onclick="executeDelete(${id})" id="btnConfirmDelete">🗑️ Ya, Hapus</button>
        </div>
    `;
    showModal(html);
}

async function executeDelete(id) {
    const btn = document.getElementById('btnConfirmDelete');
    btn.disabled = true;
    btn.textContent = '⏳ Menghapus...';

    try {
        const { status, data } = await apiDelete(`/api/data/${id}`);
        if (status === 200 && data.success) {
            showToast(data.message, 'success');
            closeModal();
            loadData(dataPage);
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        showToast('Gagal menghapus: ' + e.message, 'error');
    }
}

// ==================== ADD FORM ====================
async function submitAddForm(e) {
    e.preventDefault();
    const btn = document.getElementById('btnSubmitAdd');
    btn.disabled = true;
    btn.innerHTML = '⏳ Menyimpan...';
    showLoading('Menyimpan data & generating embedding via HuggingFace...');

    const body = {
        tipe_mobil: document.getElementById('add_tipe_mobil').value,
        varian: document.getElementById('add_varian').value,
        harga: document.getElementById('add_harga').value,
        est_bbm_kota: document.getElementById('add_bbm_kota').value,
        est_bbm_tol: document.getElementById('add_bbm_tol').value,
        spesifikasi: {
            segmentation: document.getElementById('add_segmentation').value,
            performance_specs: document.getElementById('add_performance_specs').value,
            fuel_system_capacity_efficiency_estimates: document.getElementById('add_fuel_system').value,
            dimensions: document.getElementById('add_dimensions').value,
            colour_option: document.getElementById('add_colour_option').value,
            chassis_drivetrain: document.getElementById('add_chassis').value,
            exterior: document.getElementById('add_exterior').value,
            interior_comfort: document.getElementById('add_interior').value,
            technology: document.getElementById('add_technology').value,
            safety_specs: document.getElementById('add_safety').value
        }
    };

    try {
        const { status, data } = await apiPost('/api/data', body);
        hideLoading();

        if ((status === 201 || status === 200) && data.success) {
            showToast(data.message, 'success');
            resetAddForm();
        } else {
            const errMsg = data.details ? data.details.join('\n• ') : data.error;
            showToast(errMsg, 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Gagal menyimpan: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '💾 Simpan ke Database';
    }
}

function resetAddForm() {
    document.getElementById('addForm').reset();
}

function fillSampleData() {
    document.getElementById('add_tipe_mobil').value = SAMPLE_DATA.tipe_mobil;
    document.getElementById('add_varian').value = SAMPLE_DATA.varian;
    document.getElementById('add_harga').value = SAMPLE_DATA.harga;
    document.getElementById('add_bbm_kota').value = SAMPLE_DATA.est_bbm_kota;
    document.getElementById('add_bbm_tol').value = SAMPLE_DATA.est_bbm_tol;
    document.getElementById('add_segmentation').value = SAMPLE_DATA.spesifikasi.segmentation;
    document.getElementById('add_performance_specs').value = SAMPLE_DATA.spesifikasi.performance_specs;
    document.getElementById('add_fuel_system').value = SAMPLE_DATA.spesifikasi.fuel_system_capacity_efficiency_estimates;
    document.getElementById('add_dimensions').value = SAMPLE_DATA.spesifikasi.dimensions;
    document.getElementById('add_colour_option').value = SAMPLE_DATA.spesifikasi.colour_option;
    document.getElementById('add_chassis').value = SAMPLE_DATA.spesifikasi.chassis_drivetrain;
    document.getElementById('add_exterior').value = SAMPLE_DATA.spesifikasi.exterior;
    document.getElementById('add_interior').value = SAMPLE_DATA.spesifikasi.interior_comfort;
    document.getElementById('add_technology').value = SAMPLE_DATA.spesifikasi.technology;
    document.getElementById('add_safety').value = SAMPLE_DATA.spesifikasi.safety_specs;

    // Buka spek section jika tertutup
    const spekSection = document.getElementById('spekSection');
    if (!spekSection.classList.contains('open')) {
        spekSection.classList.add('open');
    }

    showToast('Form berhasil diisi dengan contoh data Toyota New Alphard 2.5 XE', 'info');
}

// ==================== IMPORT ====================
function setupDragDrop() {
    const zone = document.getElementById('importZone');
    if (!zone) return;

    ['dragenter', 'dragover'].forEach(event => {
        zone.addEventListener(event, (e) => {
            e.preventDefault();
            zone.classList.add('dragover');
        });
    });

    ['dragleave', 'drop'].forEach(event => {
        zone.addEventListener(event, (e) => {
            e.preventDefault();
            zone.classList.remove('dragover');
        });
    });

    zone.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.name.endsWith('.json')) {
            processImportFile(file);
        } else {
            showToast('Hanya file .json yang diterima.', 'error');
        }
    });
}

function handleImportFile(e) {
    const file = e.target.files[0];
    if (file) processImportFile(file);
}

function processImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = JSON.parse(e.target.result);
            if (!Array.isArray(data)) {
                showToast('File JSON harus berupa array [ ].', 'error');
                return;
            }
            if (data.length === 0) {
                showToast('File JSON kosong.', 'warning');
                return;
            }
            if (data.length > 100) {
                showToast('Maksimal 100 data per import.', 'error');
                return;
            }

            importData = data;
            showImportPreview(data);
        } catch (err) {
            showToast('File JSON tidak valid: ' + err.message, 'error');
        }
    };
    reader.readAsText(file);
}

function showImportPreview(data) {
    document.getElementById('importCount').textContent = data.length;
    const body = document.getElementById('importPreviewBody');

    body.innerHTML = data.map((item, i) => `
        <div class="import-item">
            <div>
                <span style="color: var(--text-muted); font-size: 11px; margin-right: 8px;">#${i + 1}</span>
                <strong>${escapeHtml(item.tipe_mobil || '?')}</strong>
                <span style="color: var(--text-secondary); margin-left: 4px;">${escapeHtml(item.varian || '?')}</span>
            </div>
            <span class="cell-harga">Rp ${formatHarga(item.harga || '0')}</span>
        </div>
    `).join('');

    document.getElementById('importPreview').classList.add('visible');
}

function cancelImport() {
    importData = null;
    document.getElementById('importPreview').classList.remove('visible');
    document.getElementById('importFile').value = '';
}

async function executeImport() {
    if (!importData) return;

    const btn = document.getElementById('btnImport');
    btn.disabled = true;
    btn.innerHTML = '⏳ Mengimport...';
    showLoading(`Mengimport ${importData.length} data ke database...\nEmbeeding akan digenerate satu per satu.`);

    try {
        const { status, data } = await apiPost('/api/import', importData);
        hideLoading();

        if (data.success) {
            showToast(data.message, 'success');
            cancelImport();

            // Show details if any
            if (data.results && data.results.details && data.results.details.length > 0) {
                setTimeout(() => {
                    const detailHtml = `
                        <div class="modal-header">
                            <h2>📋 Hasil Import</h2>
                            <button class="modal-close" onclick="closeModal()">✕</button>
                        </div>
                        <div class="modal-body">
                            <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-bottom: 20px;">
                                <div class="stat-card"><div class="stat-value" style="font-size: 24px; color: var(--success);">${data.results.berhasil}</div><div class="stat-label">Berhasil</div></div>
                                <div class="stat-card"><div class="stat-value" style="font-size: 24px; color: var(--warning);">${data.results.dilewati}</div><div class="stat-label">Dilewati</div></div>
                                <div class="stat-card"><div class="stat-value" style="font-size: 24px; color: var(--error);">${data.results.gagal}</div><div class="stat-label">Gagal</div></div>
                            </div>
                            <div style="font-size: 12px; color: var(--text-secondary);">
                                ${data.results.details.map(d => `<div style="padding: 6px 0; border-bottom: 1px solid var(--border);">• ${escapeHtml(d)}</div>`).join('')}
                            </div>
                        </div>
                        <div class="modal-footer">
                            <button class="btn btn-primary" onclick="closeModal()">OK</button>
                        </div>
                    `;
                    showModal(detailHtml);
                }, 500);
            }
        } else {
            showToast(data.error, 'error');
        }
    } catch (e) {
        hideLoading();
        showToast('Import gagal: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = '🚀 Import ke Database';
    }
}

// ==================== TOGGLE SECTIONS ====================
function toggleSpek() {
    document.getElementById('spekSection').classList.toggle('open');
}

function toggleSample() {
    document.getElementById('sampleCard').classList.toggle('open');
}

function toggleImportSample() {
    document.getElementById('importSampleCard').classList.toggle('open');
}

// ==================== MODAL ====================
function showModal(html) {
    document.getElementById('modalContent').innerHTML = html;
    document.getElementById('modalOverlay').classList.add('visible');
    document.body.style.overflow = 'hidden';
}

function closeModal() {
    document.getElementById('modalOverlay').classList.remove('visible');
    document.body.style.overflow = '';
}

// Close modal on overlay click
document.getElementById('modalOverlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal();
});

// Close modal on Escape
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
});

// ==================== TOAST ====================
function showToast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.innerHTML = `<span>${icons[type] || ''}</span><span>${escapeHtml(message)}</span>`;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('toast-out');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

// ==================== LOADING ====================
function showLoading(text = 'Memproses...') {
    document.getElementById('loadingText').textContent = text;
    document.getElementById('loadingOverlay').classList.add('visible');
}

function hideLoading() {
    document.getElementById('loadingOverlay').classList.remove('visible');
}

// ==================== EXPORT DATA ====================
async function exportData() {
    const search = document.getElementById('searchInput')?.value || '';
    const searchParam = search ? `?search=${encodeURIComponent(search)}` : '';

    try {
        showToast('Menyiapkan file export...', 'info');
        const res = await fetch(`/api/export${searchParam}`);

        if (res.status === 401) {
            window.location.href = '/login';
            return;
        }

        if (!res.ok) {
            const err = await res.json();
            showToast(err.error || 'Gagal export data.', 'error');
            return;
        }

        // Extract filename from Content-Disposition header
        const disposition = res.headers.get('Content-Disposition');
        let filename = 'export_mobil.json';
        if (disposition) {
            const match = disposition.match(/filename="?([^"]+)"?/);
            if (match) filename = match[1];
        }

        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`Data berhasil di-export ke ${filename}`, 'success');
    } catch (e) {
        showToast('Gagal export data: ' + e.message, 'error');
    }
}

// ==================== LOGOUT ====================
async function logout() {
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) { /* ignore */ }
    sessionStorage.removeItem('csrf_token');
    window.location.href = '/login';
}

// ==================== UTILITIES ====================
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}

function escapeAttr(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formatHarga(harga) {
    if (!harga) return '0';
    // Hapus desimal (.00) dan format dengan titik
    const num = Math.round(parseFloat(String(harga).replace(/[^\d.]/g, '')));
    return num.toLocaleString('id-ID');
}

// ==================== EKSTRAK BROSUR AI ====================
function setupBrochureDragDrop() {
    const zone = document.getElementById('brochureZone');
    if (!zone) return;

    ['dragenter', 'dragover'].forEach(name => {
        zone.addEventListener(name, (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--accent)';
            zone.style.background = 'rgba(218, 165, 32, 0.05)';
        }, false);
    });

    ['dragleave', 'drop'].forEach(name => {
        zone.addEventListener(name, (e) => {
            e.preventDefault();
            zone.style.borderColor = 'var(--border)';
            zone.style.background = 'transparent';
        }, false);
    });

    zone.addEventListener('drop', (e) => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length > 0) {
            processSelectedBrochure(files[0]);
        }
    }, false);
}

function handleBrochureFile(event) {
    const file = event.target.files[0];
    if (file) {
        processSelectedBrochure(file);
    }
}

function processSelectedBrochure(file) {
    const allowed = ['.pdf', '.png', '.jpg', '.jpeg', '.txt'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();

    if (!allowed.includes(ext)) {
        showToast('Format file tidak didukung! Gunakan PDF, PNG, JPG, atau TXT.', 'error');
        return;
    }

    if (file.size > 10 * 1024 * 1024) { // Max 10MB
        showToast('Ukuran file terlalu besar! Maksimal 10MB.', 'error');
        return;
    }

    selectedBrochureFile = file;

    // Tampilkan icon berdasarkan tipe
    let icon = '📄';
    if (ext === '.pdf') icon = '📕';
    else if (['.png', '.jpg', '.jpeg'].includes(ext)) icon = '🖼️';
    else if (ext === '.txt') icon = '📝';

    document.getElementById('brochureFileIcon').textContent = icon;
    document.getElementById('brochureFileName').textContent = file.name;

    // Format size
    let sizeStr = (file.size / 1024).toFixed(1) + ' KB';
    if (file.size > 1024 * 1024) {
        sizeStr = (file.size / (1024 * 1024)).toFixed(2) + ' MB';
    }
    document.getElementById('brochureFileSize').textContent = `Ukuran: ${sizeStr}`;

    // Toggle view
    document.getElementById('brochureZone').style.display = 'none';
    document.getElementById('brochurePreview').style.display = 'block';
}

// Global state tambahan untuk hasil ekstraksi
let extractedCars = [];

function cancelBrochure() {
    selectedBrochureFile = null;
    document.getElementById('brochureFile').value = '';
    document.getElementById('brochureZone').style.display = 'block';
    document.getElementById('brochurePreview').style.display = 'none';
    resetBrochureResult();
}

function resetBrochureResult() {
    extractedCars = [];
    const container = document.getElementById('brochureResultContainer');
    if (container) container.style.display = 'none';
    const tbody = document.getElementById('extractedCarsTableBody');
    if (tbody) tbody.innerHTML = '';
}

async function executeBrochureExtraction() {
    if (!selectedBrochureFile) return;

    showLoading('Meminta Gemini menganalisis dan mengekstrak brosur...');
    resetBrochureResult();

    const formData = new FormData();
    formData.append('file', selectedBrochureFile);

    try {
        const { status, data } = await apiPost('/api/extract-brochure', formData, true);

        if (status === 200 && data.success) {
            extractedCars = data.data || [];

            if (extractedCars.length === 0) {
                showToast('Tidak ada data mobil yang berhasil diekstrak dari brosur.', 'warning');
                return;
            }

            showToast(`Ekstraksi berhasil! Menemukan ${extractedCars.length} mobil.`, 'success');

            // Render list
            document.getElementById('extractedCarsCount').textContent = extractedCars.length;
            const tbody = document.getElementById('extractedCarsTableBody');
            tbody.innerHTML = '';

            extractedCars.forEach((car, index) => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td><strong>${escapeHtml(car.tipe_mobil)}</strong></td>
                    <td><span class="badge" style="background: var(--bg-secondary); color: var(--text-secondary); font-size: 11px;">${escapeHtml(car.varian)}</span></td>
                    <td style="color: var(--accent); font-weight: 500;">Rp ${escapeHtml(car.harga || '—')}</td>
                    <td>${escapeHtml(car.est_bbm_kota || '—')}</td>
                    <td>${escapeHtml(car.est_bbm_tol || '—')}</td>
                    <td>
                        <button class="btn btn-success" style="padding: 4px 10px; font-size: 11px;" onclick="loadExtractedCarToForm(${index})">
                            ⚡ Tinjau & Tambah
                        </button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Tampilkan container hasil
            document.getElementById('brochureResultContainer').style.display = 'block';

            // Scroll ke container hasil
            document.getElementById('brochureResultContainer').scrollIntoView({ behavior: 'smooth' });

        } else {
            showToast(data.error || 'Gagal mengekstrak brosur.', 'error');
        }
    } catch (err) {
        console.error(err);
        showToast('Koneksi server gagal atau terputus.', 'error');
    } finally {
        hideLoading();
    }
}

function loadExtractedCarToForm(index) {
    const car = extractedCars[index];
    if (!car) return;

    // Auto-populate form Tambah Data
    document.getElementById('add_tipe_mobil').value = car.tipe_mobil || '';
    document.getElementById('add_varian').value = car.varian || '';
    document.getElementById('add_harga').value = car.harga || '';
    document.getElementById('add_bbm_kota').value = car.est_bbm_kota || '';
    document.getElementById('add_bbm_tol').value = car.est_bbm_tol || '';

    // Spesifikasi
    const spec = car.spesifikasi || {};
    document.getElementById('add_segmentation').value = spec.segmentation || '';
    document.getElementById('add_performance_specs').value = spec.performance_specs || '';
    document.getElementById('add_fuel_system').value = spec.fuel_system_capacity_efficiency_estimates || '';
    document.getElementById('add_dimensions').value = spec.dimensions || '';
    document.getElementById('add_colour_option').value = spec.colour_option || '';
    document.getElementById('add_chassis').value = spec.chassis_drivetrain || '';
    document.getElementById('add_exterior').value = spec.exterior || '';
    document.getElementById('add_interior').value = spec.interior_comfort || '';
    document.getElementById('add_technology').value = spec.technology || '';
    document.getElementById('add_safety').value = spec.safety_specs || '';

    // Pindahkan ke halaman Tambah Data untuk direview
    navigateTo('tambah');

    // Bukakan section spesifikasi agar admin bisa melihat detailnya
    const spekSec = document.getElementById('spekSection');
    if (spekSec && !spekSec.classList.contains('open')) {
        toggleSpek();
    }

    showToast(`Data '${car.tipe_mobil} ${car.varian}' dimuat ke Form. Silakan tinjau sebelum disimpan.`, 'info');
}



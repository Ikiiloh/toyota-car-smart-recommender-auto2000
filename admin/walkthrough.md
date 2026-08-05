# Walkthrough: Admin Database Management System

## Overview

Sistem admin terpisah berbasis web untuk mengelola data mobil Toyota di TiDB **tanpa harus login langsung ke TiDB**. Sistem ini **independen** dari website customer (Streamlit `app.py`).

## File yang Dibuat

| File | Fungsi |
|---|---|
| [admin_server.py]| Flask backend — REST API + login + CRUD + embedding |
| [admin/login.html]| Halaman login admin |
| [admin/index.html]| Dashboard admin (SPA) |
| [admin/style.css]| CSS dark-mode premium |
| [admin/app.js]| JavaScript — semua logic frontend |

## Cara Menjalankan

```bash
cd prototype/admin
python admin_server.py
# Buka http://localhost:5050
# Login: admin / toyota2000admin
```

## Fitur Utama

### 1. Login Aman
- Username/password dengan hashing (`werkzeug`)
- Rate limiting: maks 5 percobaan, lockout 5 menit
- CSRF token di setiap request modifikasi
- Session HTTP-only cookies

### 2. Dashboard
- Statistik: total data, total tipe unik
- Top 5 model berdasarkan jumlah varian

### 3. Data Mobil (Tabel)
- Search by ID, tipe mobil, atau varian (pencarian ID mendukung pencarian parsial maupun penuh)
- Aksi per baris: View Detail, Edit, Delete

### 4. Tambah Data (Form)
- Input satu-persatu sesuai struktur JSON
- **Contoh penulisan** dari data Toyota New Alphard 2.5 XE
- Tombol "Isi Form dengan Contoh Ini" untuk auto-fill
- Validasi semua field sebelum submit
- Auto-generate embedding via HuggingFace saat simpan

### 5. Edit Data
- Modal edit dengan pre-filled data dari database
- Re-generate embedding otomatis setelah edit (walau hanya 1 field)

### 6. Hapus Data
- Konfirmasi dialog sebelum hapus
- Hapus permanen dari `data_mobil_hybrid`

### 7. Import JSON
- Drag-and-drop file `.json`
- Preview data sebelum import
- Validasi struktur & format
- Bulk insert dengan embedding per item
- Laporan hasil (berhasil/dilewati/gagal)

## Security

| Fitur | Implementasi |
|---|---|
| Anti SQL Injection | Parameterized queries (`%s`) |
| Anti XSS | `escapeHtml()` di frontend |
| Anti CSRF | Token di header `X-CSRF-Token` |
| Anti Brute Force | Rate limit 5x percobaan / 5 menit |
| Password | Hashed via `werkzeug.security` |
| Session | HTTP-only cookie, 1 jam expiry |
| Input Validation | Server-side sanitize + max length |

## Screenshots & Demo

### Halaman Dashboard & Data
![Data Table](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\data_table_page_1781392296668.png)

### Verifikasi Fitur Search (ID, Tipe, Varian)
````carousel
![Cari Berdasarkan ID](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\search_by_id_105_1781393126549.png)
<!-- slide -->
![Cari Berdasarkan Tipe](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\search_by_type_prius_1781393143313.png)
<!-- slide -->
![Cari Berdasarkan Varian](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\search_by_variant_battery_ev_1781393157317.png)
<!-- slide -->
![Cari Kasus Case-Insensitive (veloz)](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\veloz_search_results_1781393951886.png)
````

### Tambah Data — Contoh Penulisan & Form
````carousel
![Sample Data](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\expanded_sample_data_1781392322997.png)
<!-- slide -->
![Filled Form](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\filled_form_fields_1781392337740.png)
````

### Import JSON
![Import JSON](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\import_json_page_1781392347177.png)

### Verifikasi Fitur Edit & Re-Embedding (Tanpa Logout)
````carousel
![Edit Modal Terbuka](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\edit_modal_open_1781394875404.png)
<!-- slide -->
![Proses Menyimpan & Re-embedding](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\saving_state_1781394892906.png)
<!-- slide -->
![Berhasil Disimpan & Refresh Tabel](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\final_success_state_1781394931065.png)
````

Video Rekaman Interaksi Edit:
![Rekaman Interaksi Edit](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\edit_flow_test_1781394821405.webp)

### Verifikasi Ekstraksi Transmisi (e-CVT & Mobil Listrik)
![Tabel Perbandingan Transmisi](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\comparison_table_1781396705991.png)

Video Rekaman Interaksi Perbandingan:
![Rekaman Interaksi Perbandingan Transmisi](C:\Users\muhri\.gemini\antigravity-ide\brain\bb716d90-0e0c-42d9-8a61-13c75e5f7790\transmission_comparison_1781396620715.webp)

## Kredensial Default

| Key | Value |
|---|---|
| Username | `admin` |
| Password | `toyota2000admin` |

> Ganti di `.env` dengan `ADMIN_USERNAME` dan `ADMIN_PASSWORD` untuk production.

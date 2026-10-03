# 📖 Panduan Penggunaan `extract_cli.py` (Ekstraksi & Ingestion Brosur via Terminal)

Script `extract_cli.py` adalah alat bantu berbasis baris perintah (CLI) untuk mengekstrak spesifikasi mobil Toyota dari brosur (PDF / Gambar / TXT) menggunakan **Gemini 3.1 Flash Lite**, menghitung vektor *embedding* **BGE-M3 (1024-D)**, dan langsung menyimpannya ke basis data **TiDB Serverless** tanpa perlu membuka antarmuka web admin.

---

## 📌 Prasyarat
Pastikan terminal berada di dalam folder `admin`:
```powershell
cd C:\Users\muhri\Desktop\prototype\admin
```
Pastikan file `.env` sudah memuat:
- `GOOGLE_API_KEY_EXTRACT`
- `TIDB_HOST`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_NAME`, `TIDB_PORT`

---

## 🚀 Cara Menjalankan Perintah

### 1. Ekstrak & Simpan ke File JSON (Untuk Cek Hasil Terlebih Dahulu)
Gunakan opsi `--output <nama_file.json>` untuk mengekstrak brosur dan menyimpan hasilnya ke file JSON tanpa mengubah database:
```powershell
python extract_cli.py "browsur toyota\commercial\hilux d & s cub.pdf" --output hilux.json
```
*Hasil:* File `hilux.json` akan dibuat di folder `admin` berisi spesifikasi lengkap seluruh varian.

---

### 2. Ekstrak dan LANGSUNG Simpan ke Database TiDB
Tambahkan opsi `--save-db` untuk mengekstrak brosur, menghitung vektor *embedding* BGE-M3, dan langsung menyimpannya ke tabel `data_mobil_hybrid` di TiDB:
```powershell
python extract_cli.py "browsur toyota\commercial\hilux d & s cub.pdf" --save-db
```
*Keterangan:*
- Sistem secara otomatis mengecek apakah mobil sudah ada di database (mencegah data duplikat).
- Sistem otomatis menghitung vektor *embedding* 1024-dimensi via Hugging Face Space.

---

### 3. Ekstrak dan Simpan ke JSON Sekaligus ke TiDB
Anda dapat menggabungkan kedua opsi:
```powershell
python extract_cli.py "browsur toyota\commercial\hilux d & s cub.pdf" --output hilux.json --save-db
```

---

### 4. Ekstrak Seluruh Brosur di Dalam Folder Sekaligus (*Batch Mode*)
Jika Anda memiliki banyak file brosur di dalam satu folder dan ingin memasukkan semuanya ke TiDB sekaligus:
```powershell
python extract_cli.py --dir "browsur toyota\commercial" --save-db
```
Atau ekstrak semua file di folder ke satu file JSON gabungan:
```powershell
python extract_cli.py --dir "browsur toyota\commercial" --output all_commercial.json
```

---

## 📋 Ringkasan Parameter / Opsi

| Opsi | Penjelasan | Contoh Penggunaan |
| :--- | :--- | :--- |
| `file` | Path file brosur PDF / Gambar / TXT yang akan diekstrak. | `python extract_cli.py "brosur.pdf"` |
| `--save-db` | Langsung menyimpan data dan vektor *embedding* ke TiDB Serverless. | `python extract_cli.py "brosur.pdf" --save-db` |
| `--output <file.json>` | Menyimpan hasil ekstraksi ke file JSON lokal. | `python extract_cli.py "brosur.pdf" --output data.json` |
| `--dir <folder_path>` | Memproses semua file brosur di dalam folder tertentu secara *batch*. | `python extract_cli.py --dir "browsur toyota" --save-db` |
| `-h`, `--help` | Menampilkan panduan bantuan perintah di terminal. | `python extract_cli.py --help` |

---

## ⚙️ Alur Kerja di Balik Layar
1. **PyMuPDF Scan**: Membaca dokumen PDF dan secara otomatis mendeteksi halaman yang berisi tabel spesifikasi teknis.
2. **Gemini Multimodal OCR**: Melakukan OCR visual pada halaman spesifikasi untuk menjaga keutuhan relasi kolom varian (misal: membedakan tipe bensin, diesel, dan hybrid).
3. **Stage 1 (Listing Varian)**: Mengekstrak daftar seluruh varian yang tersedia.
4. **Stage 2 (Spesifikasi Detail)**: Mengekstrak dimensi, performa mesin, sistem penggerak roda (FWD/RWD/4WD), kapasitas kursi, fitur keselamatan (TSS), dan konektivitas (T Intouch).
5. **BGE-M3 Embedding**: Menghitung vektor 1024-D dari gabungan teks nama mobil dan JSON spesifikasi.
6. **TiDB Ingestion**: Menyimpan baris data ke tabel `data_mobil_hybrid` lengkap dengan kolom `embedding`.

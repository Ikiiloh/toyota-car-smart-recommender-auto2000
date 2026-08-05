# Panduan Deploy Online: Panel Admin Toyota Auto2000

Panel Admin Anda adalah server **Python Flask**. Agar panel ini dapat diakses secara online oleh admin dan fitur **PyMuPDF (`fitz`)** berjalan lancar di server cloud, ikuti panduan berikut.

---

## 1. Persiapan File Project (Lokal)

Sebelum di-deploy, kita harus menambahkan file dependensi dan server produksi agar Flask tidak berjalan dalam mode Development (`werkzeug`).

### A. Buat File `requirements.txt`
Buat file [requirements.txt](file:///c:/Users/muhri/Desktop/toyotaranto/admin/requirements.txt) di dalam folder `admin/` untuk memberi tahu server package apa saja yang harus di-install.

Isi `requirements.txt`:
```text
Flask==3.1.3
pymupdf==1.26.7
google-genai==2.10.0
PyMySQL==1.1.2
certifi==2025.11.12
python-dotenv==1.2.1
pydantic==2.12.5
gradio_client==2.5.0
gunicorn==23.0.0
```

> [!NOTE]
> `gunicorn` (Green Unicorn) adalah WSGI HTTP Server standar produksi untuk aplikasi Flask di sistem Linux (seperti Render/Railway/VPS).
> PyMuPDF (`pymupdf`) akan di-install oleh server menggunakan *pre-built wheel* khusus Linux secara otomatis, sehingga tidak perlu kompilasi manual.

### B. Sesuaikan `admin_server.py` untuk Produksi
Pastikan pemanggilan `.env` dinamis dan port di-bind ke env variable `PORT` yang disediakan oleh Cloud Hosting.

Modifikasi baris terbawah [admin_server.py](file:///c:/Users/muhri/Desktop/toyotaranto/admin/admin_server.py):
```python
if __name__ == '__main__':
    # Membaca port dinamis dari lingkungan cloud (default 5050)
    port = int(os.getenv("PORT", 5050))
    # Jangan gunakan debug=True di server produksi
    app.run(host='0.0.0.0', port=port)
```

---

## 2. Pilihan Deploy Online (Paling Direkomendasikan)

### Opsi A: Render.com (Gratis & Paling Mudah)
Render adalah platform PaaS (Platform as a Service) yang sangat ramah untuk Python Flask.

1. Hubungkan folder `admin/` Anda ke Git Repository (GitHub/GitLab).
2. Buat akun di [Render.com](https://render.com).
3. Klik **New** -> **Web Service**.
4. Hubungkan repository GitHub Anda.
5. Konfigurasikan detail berikut:
   - **Runtime:** `Python`
   - **Build Command:** `pip install -r admin/requirements.txt`
   - **Start Command:** `gunicorn --directory admin admin_server:app`
6. Masuk ke tab **Environment Variables** di Render, lalu tambahkan semua variabel dari berkas `.env` Anda:
   - `GOOGLE_API_KEY`
   - `TIDB_HOST`, `TIDB_USER`, `TIDB_PASSWORD`, `TIDB_NAME`
   - `ADMIN_USERNAME`, `ADMIN_PASSWORD`
   - `ADMIN_SECRET_KEY` (Ganti dengan string acak panjang untuk keamanan session cookie)
7. Klik **Deploy Web Service**. Render akan membuatkan domain HTTPS gratis (misal: `toyota-admin.onrender.com`).

---

### Opsi B: Railway.app (Sangat Cepat & Berbayar Ringan)
Railway adalah alternatif Render yang memiliki deployment lebih cepat dan toleransi error yang baik.

1. Install Railway CLI atau hubungkan via GitHub.
2. Buat project baru di Railway.
3. Di dalam folder `admin/`, buat file bernama `Procfile` (tanpa ekstensi):
   ```text
   web: gunicorn admin_server:app
   ```
4. Tambahkan seluruh isi `.env` ke bagian **Variables** di Dashboard Railway.
5. Deploy menggunakan perintah `railway up` dari terminal Anda di dalam folder `admin/`.

---

### Opsi C: Virtual Private Server (VPS - Ubuntu 22.04 / 24.04)
Jika Anda menyewa VPS (seperti DigitalOcean, Niagahoster, AWS, atau Alibaba Cloud):

1. **Install Python & Pip:**
   ```bash
   sudo apt update
   sudo apt install python3 python3-pip python3-venv git -y
   ```
2. **Clone & Buat Virtual Environment:**
   ```bash
   git clone <repo-url>
   cd admin
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```
3. **Konfigurasi Gunicorn & Systemd:**
   Buat service systemd agar Flask selalu berjalan di background meskipun server restart.
   ```bash
   sudo nano /etc/systemd/system/toyota-admin.service
   ```
   Isi file service:
   ```ini
   [Unit]
   Description=Toyota Admin Panel Service
   After=network.target

   [Service]
   User=ubuntu
   WorkingDirectory=/home/ubuntu/admin
   ExecStart=/home/ubuntu/admin/venv/bin/gunicorn --workers 3 --bind 127.0.0.1:5050 admin_server:app
   Restart=always

   [Install]
   WantedBy=multi-user.target
   ```
4. **Jalankan Service:**
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl start toyota-admin
   sudo systemctl enable toyota-admin
   ```
5. **Install Nginx & SSL (Certbot):**
   Gunakan Nginx sebagai reverse proxy untuk mengarahkan port `80/443` ke port internal `5050` milik Flask, dan pasang SSL gratis dari Let's Encrypt agar panel admin berjalan dengan protokol aman `https://`.

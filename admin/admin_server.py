"""
ADMIN DATABASE MANAGEMENT SYSTEM
Server Flask terpisah untuk mengelola data mobil Toyota di TiDB.
Jalankan: python admin_server.py
Akses: http://localhost:5050
"""

import json
import os
import sys
import time
import secrets
import tempfile
import functools
from datetime import datetime
from decimal import Decimal, InvalidOperation

from flask import (
    Flask, request, jsonify, session, redirect, url_for,
    send_from_directory, abort
)
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv

# --- SETUP ENVIRONMENT & PATH ---
base_dir = os.path.dirname(os.path.abspath(__file__))
if base_dir not in sys.path:
    sys.path.insert(0, base_dir)

parent_dir = os.path.dirname(base_dir)
load_dotenv(dotenv_path=os.path.join(parent_dir, 'toyotarantauprapat', '.env'))
load_dotenv(dotenv_path=os.path.join(parent_dir, '.env'))
load_dotenv()

# --- IMPORT MODULE DARI EXTRACT_CLI ---
# Memanfaatkan logic ekstraksi brosur (Gemini OCR), embedding BGE-M3, dan koneksi TiDB dari extract_cli.py
from extract_cli import (
    get_embedding,
    get_db_connection,
    extract_brochure_file,
    save_cars_to_tidb
)

# Alias fungsi database untuk kompatibilitas fungsi internal
get_db = get_db_connection

# --- FLASK APP CONFIGURATION ---
app = Flask(__name__, static_folder=base_dir, static_url_path='/static')
app.secret_key = os.getenv("ADMIN_SECRET_KEY", secrets.token_hex(32))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 jam
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # Max upload 16MB

# --- SECURITY HEADERS ---
@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self';"
    return response

# --- ADMIN CREDENTIALS (hashed) ---
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = generate_password_hash(
    os.getenv("ADMIN_PASSWORD", "toyota2000admin")
)

# --- RATE LIMITING ---
_login_attempts = {}  # {ip: {"count": int, "last_attempt": float}}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_SECONDS = 300  # 5 menit

# --- SECURITY & VALIDATION HELPERS ---
def generate_csrf_token():
    """Generate dan simpan CSRF token di session."""
    if '_csrf_token' not in session:
        session['_csrf_token'] = secrets.token_hex(32)
    return session['_csrf_token']


def validate_csrf_token():
    """Validasi CSRF token dari header atau form data."""
    token = request.headers.get('X-CSRF-Token') or request.form.get('_csrf_token')
    if not token or token != session.get('_csrf_token'):
        abort(403, description="CSRF token tidak valid.")


def check_rate_limit(ip):
    """Cek rate limit login berdasarkan IP."""
    now = time.time()
    if ip in _login_attempts:
        info = _login_attempts[ip]
        if now - info["last_attempt"] > LOCKOUT_SECONDS:
            del _login_attempts[ip]
            return True
        if info["count"] >= MAX_LOGIN_ATTEMPTS:
            return False
    return True


def record_login_attempt(ip, success):
    """Catat percobaan login."""
    now = time.time()
    if success:
        _login_attempts.pop(ip, None)
    else:
        if ip not in _login_attempts:
            _login_attempts[ip] = {"count": 0, "last_attempt": now}
        _login_attempts[ip]["count"] += 1
        _login_attempts[ip]["last_attempt"] = now


def login_required(f):
    """Decorator untuk endpoint yang butuh autentikasi."""
    @functools.wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.is_json or request.path.startswith('/api/'):
                return jsonify({"error": "Unauthorized", "redirect": "/login"}), 401
            return redirect(url_for('login_page'))
        return f(*args, **kwargs)
    return decorated


def sanitize_string(value):
    """Sanitize input string — strip whitespace, batas panjang."""
    if not isinstance(value, str):
        return ""
    return value.strip()[:5000]  # Max 5000 karakter per field


def validate_car_data(data):
    """Validasi struktur data mobil sesuai format JSON."""
    errors = []
    required_top = ['tipe_mobil', 'varian', 'harga', 'est_bbm_kota', 'est_bbm_tol']
    required_spek = [
        'segmentation', 'performance_specs',
        'fuel_system_capacity_efficiency_estimates', 'dimensions',
        'colour_option', 'chassis_drivetrain', 'exterior',
        'interior_comfort', 'technology', 'safety_specs'
    ]

    for field in required_top:
        if field in ['harga', 'est_bbm_kota', 'est_bbm_tol']:
            if field not in data:
                errors.append(f"Field '{field}' wajib ada di JSON (boleh kosong).")
        else:
            if not data.get(field):
                errors.append(f"Field '{field}' wajib diisi.")

    spek = data.get('spesifikasi', {})
    if not isinstance(spek, dict):
        errors.append("Field 'spesifikasi' harus berupa objek.")
    else:
        for field in required_spek:
            if not spek.get(field):
                errors.append(f"Spesifikasi '{field}' wajib diisi.")

    # Validasi format harga
    if data.get('harga'):
        harga_clean = data['harga'].replace('.', '').replace(',', '')
        if not harga_clean.isdigit():
            errors.append("Format harga tidak valid. Gunakan format: 1.355.000.000")

    return errors


# --- ROUTES: AUTHENTICATION ---
@app.route('/login', methods=['GET'])
def login_page():
    """Serve halaman login."""
    if session.get('logged_in'):
        return redirect('/')
    return send_from_directory(app.static_folder, 'login.html')


@app.route('/api/login', methods=['POST'])
def login_api():
    """API login dengan rate limiting."""
    ip = request.remote_addr
    if not check_rate_limit(ip):
        remaining = LOCKOUT_SECONDS - (time.time() - _login_attempts[ip]["last_attempt"])
        return jsonify({
            "error": f"Terlalu banyak percobaan. Coba lagi dalam {int(remaining)} detik."
        }), 429

    data = request.get_json(silent=True) or {}
    username = sanitize_string(data.get('username', ''))
    password = data.get('password', '')

    if username == ADMIN_USERNAME and check_password_hash(ADMIN_PASSWORD_HASH, password):
        record_login_attempt(ip, True)
        session.permanent = True
        session['logged_in'] = True
        session['username'] = username
        session['login_time'] = datetime.now().isoformat()
        generate_csrf_token()
        return jsonify({
            "success": True,
            "csrf_token": session['_csrf_token']
        })
    else:
        record_login_attempt(ip, False)
        attempts_left = MAX_LOGIN_ATTEMPTS - _login_attempts.get(ip, {}).get("count", 0)
        return jsonify({
            "error": f"Username atau password salah. Sisa percobaan: {max(0, attempts_left)}"
        }), 401


@app.route('/api/logout', methods=['POST'])
def logout_api():
    """Logout dan hapus session."""
    session.clear()
    return jsonify({"success": True})


@app.route('/api/csrf-token', methods=['GET'])
@login_required
def get_csrf():
    """Ambil CSRF token setelah login."""
    return jsonify({"csrf_token": generate_csrf_token()})


# --- ROUTES: PAGES ---
@app.route('/')
@login_required
def admin_page():
    """Serve halaman admin utama."""
    return send_from_directory(app.static_folder, 'index.html')


# --- ROUTES: API STATS & CRUD ---
@app.route('/api/stats', methods=['GET'])
@login_required
def get_stats():
    """Statistik dashboard."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) as total FROM data_mobil_hybrid")
            total = cur.fetchone()['total']

            cur.execute("SELECT COUNT(DISTINCT tipe_mobil) as tipe FROM data_mobil_hybrid")
            tipe = cur.fetchone()['tipe']

            cur.execute("""
                SELECT tipe_mobil, COUNT(*) as jumlah 
                FROM data_mobil_hybrid 
                GROUP BY tipe_mobil 
                ORDER BY jumlah DESC 
                LIMIT 5
            """)
            top_models = cur.fetchall()

        return jsonify({
            "total_data": total,
            "total_tipe": tipe,
            "top_models": top_models
        })
    finally:
        conn.close()


@app.route('/api/data', methods=['GET'])
@login_required
def get_data():
    """Ambil semua data dengan pagination dan search."""
    page = max(1, request.args.get('page', 1, type=int))
    per_page = min(50, max(1, request.args.get('per_page', 15, type=int)))
    search = sanitize_string(request.args.get('search', ''))
    offset = (page - 1) * per_page

    conn = get_db()
    try:
        with conn.cursor() as cur:
            where = ""
            params = []
            if search:
                where = "WHERE CAST(id AS CHAR) LIKE %s OR LOWER(tipe_mobil) LIKE %s OR LOWER(varian) LIKE %s"
                params = [f"%{search.lower()}%", f"%{search.lower()}%", f"%{search.lower()}%"]

            cur.execute(f"SELECT COUNT(*) as total FROM data_mobil_hybrid {where}", params)
            total = cur.fetchone()['total']

            cur.execute(f"""
                SELECT id, tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail
                FROM data_mobil_hybrid
                {where}
                ORDER BY id DESC
                LIMIT %s OFFSET %s
            """, params + [per_page, offset])
            rows = cur.fetchall()

            data = []
            for row in rows:
                try:
                    spek = json.loads(row['spesifikasi_detail']) if isinstance(row['spesifikasi_detail'], str) else row['spesifikasi_detail']
                except (json.JSONDecodeError, TypeError):
                    spek = {}

                data.append({
                    "id": row['id'],
                    "tipe_mobil": row['tipe_mobil'],
                    "varian": row['varian'],
                    "harga": str(row['harga']),
                    "bbm_kota": str(row['bbm_kota']) if row['bbm_kota'] else "0",
                    "bbm_tol": str(row['bbm_tol']) if row['bbm_tol'] else "0",
                    "spesifikasi": spek
                })

        return jsonify({
            "data": data,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page
        })
    finally:
        conn.close()


@app.route('/api/data/<int:car_id>', methods=['GET'])
@login_required
def get_single_data(car_id):
    """Ambil satu data berdasarkan ID."""
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT id, tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail
                FROM data_mobil_hybrid WHERE id = %s
            """, (car_id,))
            row = cur.fetchone()

        if not row:
            return jsonify({"error": "Data tidak ditemukan."}), 404

        try:
            spek = json.loads(row['spesifikasi_detail']) if isinstance(row['spesifikasi_detail'], str) else row['spesifikasi_detail']
        except (json.JSONDecodeError, TypeError):
            spek = {}

        return jsonify({
            "id": row['id'],
            "tipe_mobil": row['tipe_mobil'],
            "varian": row['varian'],
            "harga": str(row['harga']),
            "bbm_kota": str(row['bbm_kota']) if row['bbm_kota'] else "0",
            "bbm_tol": str(row['bbm_tol']) if row['bbm_tol'] else "0",
            "spesifikasi": spek
        })
    finally:
        conn.close()


@app.route('/api/data', methods=['POST'])
@login_required
def create_data():
    """Tambah data baru + generate embedding via BGE-M3."""
    validate_csrf_token()
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Data JSON tidak valid."}), 400

    errors = validate_car_data(data)
    if errors:
        return jsonify({"error": "Validasi gagal.", "details": errors}), 400

    tipe = sanitize_string(data['tipe_mobil'])
    varian = sanitize_string(data['varian'])
    harga_str = data.get('harga', '').replace('.', '').replace(',', '')
    if not harga_str:
        harga_str = '0'
    est_kota = sanitize_string(data.get('est_bbm_kota', 'N/A'))
    est_tol = sanitize_string(data['est_bbm_tol'])

    try:
        harga = Decimal(harga_str)
    except (InvalidOperation, ValueError):
        return jsonify({"error": "Format harga tidak valid."}), 400

    raw_kota = est_kota.replace(' km/l', '').replace('km/l', '').strip()
    raw_tol = est_tol.replace(' km/l', '').replace('km/l', '').strip()
    bbm_kota = Decimal(raw_kota) if raw_kota.replace('.', '').isdigit() else Decimal(0)
    bbm_tol = Decimal(raw_tol) if raw_tol.replace('.', '').isdigit() else Decimal(0)

    spek = {}
    for key in ['segmentation', 'performance_specs', 'fuel_system_capacity_efficiency_estimates',
                'dimensions', 'colour_option', 'chassis_drivetrain', 'exterior',
                'interior_comfort', 'technology', 'safety_specs']:
        spek[key] = sanitize_string(data.get('spesifikasi', {}).get(key, ''))

    spek_json = json.dumps(spek, ensure_ascii=False)

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM data_mobil_hybrid WHERE LOWER(tipe_mobil) = %s AND LOWER(varian) = %s",
                (tipe.lower(), varian.lower())
            )
            if cur.fetchone():
                return jsonify({"error": f"Data '{tipe} {varian}' sudah ada di database."}), 409

        # Generate embedding via modul extract_cli
        teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
        vektor = get_embedding(teks_embed)
        if vektor is None:
            return jsonify({"error": "Gagal generate embedding. Layanan embedding tidak merespons."}), 503

        vektor_str = str(vektor)

        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO data_mobil_hybrid 
                (tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail, embedding)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (tipe, varian, harga, bbm_kota, bbm_tol, spek_json, vektor_str))
            new_id = cur.lastrowid
        conn.commit()

        return jsonify({
            "success": True,
            "message": f"Data '{tipe} {varian}' berhasil ditambahkan.",
            "id": new_id
        }), 201

    except Exception as e:
        conn.rollback()
        return jsonify({"error": f"Gagal menyimpan data: {str(e)}"}), 500
    finally:
        conn.close()


@app.route('/api/data/<int:car_id>', methods=['PUT'])
@login_required
def update_data(car_id):
    """Update data + re-generate embedding via BGE-M3."""
    validate_csrf_token()
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Data JSON tidak valid."}), 400

    errors = validate_car_data(data)
    if errors:
        return jsonify({"error": "Validasi gagal.", "details": errors}), 400

    tipe = sanitize_string(data['tipe_mobil'])
    varian = sanitize_string(data['varian'])
    harga_str = data.get('harga', '').replace('.', '').replace(',', '')
    if not harga_str:
        harga_str = '0'
    est_kota = sanitize_string(data.get('est_bbm_kota', 'N/A'))
    est_tol = sanitize_string(data['est_bbm_tol'])

    try:
        harga = Decimal(harga_str)
    except (InvalidOperation, ValueError):
        return jsonify({"error": "Format harga tidak valid."}), 400

    raw_kota = est_kota.replace(' km/l', '').replace('km/l', '').strip()
    raw_tol = est_tol.replace(' km/l', '').replace('km/l', '').strip()
    bbm_kota = Decimal(raw_kota) if raw_kota.replace('.', '').isdigit() else Decimal(0)
    bbm_tol = Decimal(raw_tol) if raw_tol.replace('.', '').isdigit() else Decimal(0)

    spek = {}
    for key in ['segmentation', 'performance_specs', 'fuel_system_capacity_efficiency_estimates',
                'dimensions', 'colour_option', 'chassis_drivetrain', 'exterior',
                'interior_comfort', 'technology', 'safety_specs']:
        spek[key] = sanitize_string(data.get('spesifikasi', {}).get(key, ''))

    spek_json = json.dumps(spek, ensure_ascii=False)

    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM data_mobil_hybrid WHERE id = %s", (car_id,))
            if not cur.fetchone():
                return jsonify({"error": "Data tidak ditemukan."}), 404

            cur.execute(
                "SELECT id FROM data_mobil_hybrid WHERE LOWER(tipe_mobil) = %s AND LOWER(varian) = %s AND id != %s",
                (tipe.lower(), varian.lower(), car_id)
            )
            if cur.fetchone():
                return jsonify({"error": f"Data '{tipe} {varian}' sudah ada di entri lain."}), 409

        # Re-generate embedding via modul extract_cli
        teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
        vektor = get_embedding(teks_embed)
        if vektor is None:
            return jsonify({"error": "Gagal re-generate embedding. Layanan embedding tidak merespons."}), 503

        vektor_str = str(vektor)

        with conn.cursor() as cur:
            cur.execute("""
                UPDATE data_mobil_hybrid 
                SET tipe_mobil = %s, varian = %s, harga = %s, 
                    bbm_kota = %s, bbm_tol = %s, 
                    spesifikasi_detail = %s, embedding = %s
                WHERE id = %s
            """, (tipe, varian, harga, bbm_kota, bbm_tol, spek_json, vektor_str, car_id))
        conn.commit()

        return jsonify({
            "success": True,
            "message": f"Data '{tipe} {varian}' berhasil diperbarui (embedding regenerated)."
        })

    except Exception as e:
        conn.rollback()
        return jsonify({"error": f"Gagal update data: {str(e)}"}), 500
    finally:
        conn.close()


@app.route('/api/data/<int:car_id>', methods=['DELETE'])
@login_required
def delete_data(car_id):
    """Hapus data berdasarkan ID."""
    validate_csrf_token()
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute("SELECT tipe_mobil, varian FROM data_mobil_hybrid WHERE id = %s", (car_id,))
            row = cur.fetchone()
            if not row:
                return jsonify({"error": "Data tidak ditemukan."}), 404

            cur.execute("DELETE FROM data_mobil_hybrid WHERE id = %s", (car_id,))
        conn.commit()

        return jsonify({
            "success": True,
            "message": f"Data '{row['tipe_mobil']} {row['varian']}' berhasil dihapus."
        })
    except Exception as e:
        conn.rollback()
        return jsonify({"error": f"Gagal menghapus: {str(e)}"}), 500
    finally:
        conn.close()


# --- ROUTES: BULK IMPORT & BROCHURE EXTRACTION (MENGGUNAKAN EXTRACT_CLI) ---
@app.route('/api/import', methods=['POST'])
@login_required
def import_data():
    """Import bulk data dari file JSON dengan pembuatan embedding otomatis."""
    validate_csrf_token()

    if 'file' not in request.files:
        data_list = request.get_json(silent=True)
    else:
        file = request.files['file']
        if not file.filename.endswith('.json'):
            return jsonify({"error": "Hanya file .json yang diterima."}), 400
        try:
            content = file.read().decode('utf-8')
            data_list = json.loads(content)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            return jsonify({"error": f"File JSON tidak valid: {str(e)}"}), 400

    if not isinstance(data_list, list):
        return jsonify({"error": "Data harus berupa array JSON."}), 400

    if len(data_list) > 100:
        return jsonify({"error": "Maksimal 100 data per import."}), 400

    all_errors = []
    for i, item in enumerate(data_list):
        errs = validate_car_data(item)
        if errs:
            all_errors.append({"index": i, "tipe": item.get('tipe_mobil', '?'), "errors": errs})

    if all_errors:
        return jsonify({
            "error": "Beberapa data tidak valid.",
            "details": all_errors
        }), 400

    conn = get_db()
    results = {"berhasil": 0, "dilewati": 0, "gagal": 0, "details": []}

    try:
        for item in data_list:
            tipe = sanitize_string(item['tipe_mobil'])
            varian = sanitize_string(item['varian'])
            harga_str = item.get('harga', '').replace('.', '').replace(',', '')
            if not harga_str:
                harga_str = '0'

            try:
                harga = Decimal(harga_str)
            except (InvalidOperation, ValueError):
                results["gagal"] += 1
                results["details"].append(f"'{tipe} {varian}': format harga tidak valid")
                continue

            raw_kota = item.get('est_bbm_kota', 'N/A').replace(' km/l', '').replace('km/l', '').strip()
            raw_tol = item.get('est_bbm_tol', 'N/A').replace(' km/l', '').replace('km/l', '').strip()
            bbm_kota = Decimal(raw_kota) if raw_kota.replace('.', '').isdigit() else Decimal(0)
            bbm_tol = Decimal(raw_tol) if raw_tol.replace('.', '').isdigit() else Decimal(0)

            spek = {}
            for key in ['segmentation', 'performance_specs', 'fuel_system_capacity_efficiency_estimates',
                        'dimensions', 'colour_option', 'chassis_drivetrain', 'exterior',
                        'interior_comfort', 'technology', 'safety_specs']:
                spek[key] = sanitize_string(item.get('spesifikasi', {}).get(key, ''))

            spek_json = json.dumps(spek, ensure_ascii=False)

            # Cek duplikat
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM data_mobil_hybrid WHERE LOWER(tipe_mobil) = %s AND LOWER(varian) = %s",
                    (tipe.lower(), varian.lower())
                )
                if cur.fetchone():
                    results["dilewati"] += 1
                    results["details"].append(f"'{tipe} {varian}': sudah ada di database")
                    continue

            # Generate embedding via extract_cli
            teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
            vektor = get_embedding(teks_embed)
            if vektor is None:
                results["gagal"] += 1
                results["details"].append(f"'{tipe} {varian}': gagal generate embedding")
                continue

            vektor_str = str(vektor)

            try:
                with conn.cursor() as cur:
                    cur.execute("""
                        INSERT INTO data_mobil_hybrid 
                        (tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail, embedding)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                    """, (tipe, varian, harga, bbm_kota, bbm_tol, spek_json, vektor_str))
                conn.commit()
                results["berhasil"] += 1
            except Exception as e:
                conn.rollback()
                results["gagal"] += 1
                results["details"].append(f"'{tipe} {varian}': {str(e)[:100]}")

            time.sleep(0.3)

        return jsonify({
            "success": True,
            "message": f"Import selesai: {results['berhasil']} berhasil, {results['dilewati']} dilewati, {results['gagal']} gagal.",
            "results": results
        })
    finally:
        conn.close()


@app.route('/api/extract-brochure', methods=['POST'])
@login_required
def extract_brochure():
    """
    Ekstrak brosur PDF/Image/TXT menggunakan pipeline multimodal dari extract_cli.py.
    """
    validate_csrf_token()

    if 'file' not in request.files:
        return jsonify({"error": "File tidak ditemukan dalam request."}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "Nama file kosong."}), 400

    filename = file.filename
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ['.pdf', '.png', '.jpg', '.jpeg', '.txt', '.text']:
        return jsonify({"error": "Format file tidak didukung. Gunakan PDF, PNG, JPG, atau TXT."}), 400

    # Simpan sementara file yang diunggah untuk diproses oleh extract_brochure_file
    temp_dir = tempfile.mkdtemp()
    temp_path = os.path.join(temp_dir, filename)

    try:
        file.save(temp_path)
        print(f"[Admin Server] Mengekstrak brosur '{filename}' melalui modul extract_cli...")
        
        # Panggil fungsi inti dari extract_cli.py
        extracted_data = extract_brochure_file(temp_path)

        if not extracted_data:
            return jsonify({
                "success": False,
                "error": "Tidak ada data mobil yang berhasil diekstrak dari brosur."
            }), 422

        return jsonify({
            "success": True,
            "data": extracted_data
        })

    except Exception as e:
        print(f"[ERROR] Gagal memproses ekstraksi via extract_cli: {e}")
        return jsonify({"error": f"Gagal memproses brosur: {str(e)}"}), 500

    finally:
        # Bersihkan file temporary
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass
        if os.path.exists(temp_dir):
            try:
                os.rmdir(temp_dir)
            except Exception:
                pass


@app.route('/api/export', methods=['GET'])
@login_required
def export_data():
    """Export semua data mobil sebagai file JSON yang bisa di-import ulang."""
    search = sanitize_string(request.args.get('search', ''))

    conn = get_db()
    try:
        with conn.cursor() as cur:
            where = ""
            params = []
            if search:
                where = "WHERE LOWER(tipe_mobil) LIKE %s OR LOWER(varian) LIKE %s"
                params = [f"%{search.lower()}%", f"%{search.lower()}%"]

            cur.execute(f"""
                SELECT id, tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail
                FROM data_mobil_hybrid
                {where}
                ORDER BY tipe_mobil ASC, varian ASC
            """, params)
            rows = cur.fetchall()

        export_list = []
        for row in rows:
            try:
                spek = json.loads(row['spesifikasi_detail']) if isinstance(row['spesifikasi_detail'], str) else row['spesifikasi_detail']
            except (json.JSONDecodeError, TypeError):
                spek = {}

            harga_raw = int(row['harga']) if row['harga'] else 0
            harga_formatted = f"{harga_raw:,}".replace(",", ".")

            bbm_kota_val = str(row['bbm_kota']) if row['bbm_kota'] else "0"
            bbm_tol_val = str(row['bbm_tol']) if row['bbm_tol'] else "0"

            export_list.append({
                "tipe_mobil": row['tipe_mobil'],
                "varian": row['varian'],
                "harga": harga_formatted,
                "est_bbm_kota": f"{bbm_kota_val} km/l",
                "est_bbm_tol": f"{bbm_tol_val} km/l",
                "spesifikasi": spek
            })

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        suffix = f"_{search}" if search else ""
        filename = f"export_mobil{suffix}_{timestamp}.json"

        response_data = json.dumps(export_list, ensure_ascii=False, indent=2)
        response = app.response_class(
            response=response_data,
            mimetype='application/json',
            headers={
                'Content-Disposition': f'attachment; filename="{filename}"'
            }
        )
        return response

    except Exception as e:
        return jsonify({"error": f"Gagal export data: {str(e)}"}), 500
    finally:
        conn.close()


if __name__ == '__main__':
    print("=" * 55)
    print("  ADMIN DATABASE - Toyota Auto2000 Rantauprapat")
    print("  Akses: http://localhost:5050")
    print(f"  Login: {ADMIN_USERNAME} / [lihat .env]")
    print("=" * 55)
    port = int(os.getenv("PORT", 5050))
    app.run(host='0.0.0.0', port=port)

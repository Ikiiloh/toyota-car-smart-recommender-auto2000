"""
ADMIN DATABASE MANAGEMENT SYSTEM
Server Flask terpisah untuk mengelola data mobil Toyota di TiDB.
Jalankan: python admin_server.py
Akses: http://localhost:5050
"""

import json
import os
import time
import secrets
import functools
import fitz
from datetime import datetime
from decimal import Decimal, InvalidOperation

import pymysql
import certifi
from flask import (
    Flask, request, jsonify, session, redirect, url_for,
    send_from_directory, abort, g
)
from werkzeug.security import generate_password_hash, check_password_hash
from dotenv import load_dotenv
from gradio_client import Client
from google import genai
from google.genai import types
from pydantic import BaseModel, Field


# --- SETUP ---
# Load .env dari folder toyotarantauprapat (sibling directory)
load_dotenv(dotenv_path=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'toyotarantauprapat', '.env'))

base_dir = os.path.dirname(os.path.abspath(__file__))
app = Flask(__name__, static_folder=base_dir, static_url_path='/static')
app.secret_key = os.getenv("ADMIN_SECRET_KEY", secrets.token_hex(32))
app.config['SESSION_COOKIE_HTTPONLY'] = True
app.config['SESSION_COOKIE_SAMESITE'] = 'Lax'
app.config['PERMANENT_SESSION_LIFETIME'] = 3600  # 1 jam
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024  # Max upload 16MB

# --- SECURITY HEADERS (Clickjacking, etc.) ---
@app.after_request
def add_security_headers(response):
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Content-Security-Policy'] = "frame-ancestors 'self';"
    return response

# --- ADMIN CREDENTIALS (hashed) ---
# Default: admin / toyota2000admin
# Ganti password di .env dengan ADMIN_USERNAME dan ADMIN_PASSWORD
ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD_HASH = generate_password_hash(
    os.getenv("ADMIN_PASSWORD", "toyota2000admin")
)

# --- RATE LIMITING ---
_login_attempts = {}  # {ip: {"count": int, "last_attempt": float}}
MAX_LOGIN_ATTEMPTS = 5
LOCKOUT_SECONDS = 300  # 5 menit

# --- HUGGING FACE EMBEDDING CLIENT ---
_hf_client = None

def get_hf_client():
    """Lazy-init HuggingFace client untuk embedding."""
    global _hf_client
    if _hf_client is None:
        try:
            _hf_client = Client("Ikiiloh/RAG-CAR", httpx_kwargs={"timeout": 120.0})
        except Exception as e:
            print(f"[ERROR] Gagal koneksi HuggingFace: {e}")
            return None
    return _hf_client


def get_embedding(text):
    """Dapatkan embedding vector dari HuggingFace Space."""
    global _hf_client
    client = get_hf_client()
    if client is None:
        return None
    try:
        result = client.predict(text=text, api_name="/on_click")
        if isinstance(result, tuple):
            return result[0]
        return result
    except Exception as e:
        print(f"[ERROR] Embedding gagal: {e}")
        # Reset client agar reinisialisasi ulang jika koneksi rusak/stale
        _hf_client = None
        return None


# --- DATABASE ---
def get_db():
    """Buat koneksi database TiDB."""
    return pymysql.connect(
        host=os.getenv("TIDB_HOST"),
        user=os.getenv("TIDB_USER"),
        password=os.getenv("TIDB_PASSWORD"),
        database=os.getenv("TIDB_NAME"),
        port=4000,
        ssl_verify_cert=True,
        ssl_verify_identity=True,
        ssl_ca=certifi.where(),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )


# --- SECURITY HELPERS ---
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
        # Reset jika sudah lewat lockout
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


# --- ROUTES: AUTH ---
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


# --- ROUTES: API DATA ---
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
            # Base query tanpa embedding (terlalu besar untuk dikirim ke frontend)
            where = ""
            params = []
            if search:
                where = "WHERE CAST(id AS CHAR) LIKE %s OR LOWER(tipe_mobil) LIKE %s OR LOWER(varian) LIKE %s"
                params = [f"%{search.lower()}%", f"%{search.lower()}%", f"%{search.lower()}%"]

            # Count total
            cur.execute(f"SELECT COUNT(*) as total FROM data_mobil_hybrid {where}", params)
            total = cur.fetchone()['total']

            # Fetch data
            cur.execute(f"""
                SELECT id, tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail
                FROM data_mobil_hybrid
                {where}
                ORDER BY id DESC
                LIMIT %s OFFSET %s
            """, params + [per_page, offset])
            rows = cur.fetchall()

            # Format data
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
    """Tambah data baru + generate embedding."""
    validate_csrf_token()
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Data JSON tidak valid."}), 400

    # Validasi
    errors = validate_car_data(data)
    if errors:
        return jsonify({"error": "Validasi gagal.", "details": errors}), 400

    # Sanitize
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

    # Parse BBM
    raw_kota = est_kota.replace(' km/l', '').replace('km/l', '').strip()
    raw_tol = est_tol.replace(' km/l', '').replace('km/l', '').strip()
    bbm_kota = Decimal(raw_kota) if raw_kota.replace('.', '').isdigit() else Decimal(0)
    bbm_tol = Decimal(raw_tol) if raw_tol.replace('.', '').isdigit() else Decimal(0)

    # Sanitize spesifikasi
    spek = {}
    for key in ['segmentation', 'performance_specs', 'fuel_system_capacity_efficiency_estimates',
                'dimensions', 'colour_option', 'chassis_drivetrain', 'exterior',
                'interior_comfort', 'technology', 'safety_specs']:
        spek[key] = sanitize_string(data.get('spesifikasi', {}).get(key, ''))

    spek_json = json.dumps(spek, ensure_ascii=False)

    # Cek duplikat
    conn = get_db()
    try:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM data_mobil_hybrid WHERE tipe_mobil = %s AND varian = %s",
                (tipe, varian)
            )
            if cur.fetchone():
                return jsonify({"error": f"Data '{tipe} {varian}' sudah ada di database."}), 409

        # Generate embedding
        teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
        vektor = get_embedding(teks_embed)
        if vektor is None:
            return jsonify({"error": "Gagal generate embedding. HuggingFace tidak merespons."}), 503

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
    """Update data + re-generate embedding."""
    validate_csrf_token()
    data = request.get_json(silent=True)
    if not data:
        return jsonify({"error": "Data JSON tidak valid."}), 400

    # Validasi
    errors = validate_car_data(data)
    if errors:
        return jsonify({"error": "Validasi gagal.", "details": errors}), 400

    # Sanitize
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
        # Cek data ada
        with conn.cursor() as cur:
            cur.execute("SELECT id FROM data_mobil_hybrid WHERE id = %s", (car_id,))
            if not cur.fetchone():
                return jsonify({"error": "Data tidak ditemukan."}), 404

            # Cek duplikat (jika tipe/varian berubah)
            cur.execute(
                "SELECT id FROM data_mobil_hybrid WHERE tipe_mobil = %s AND varian = %s AND id != %s",
                (tipe, varian, car_id)
            )
            if cur.fetchone():
                return jsonify({"error": f"Data '{tipe} {varian}' sudah ada di entri lain."}), 409

        # Re-generate embedding
        teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
        vektor = get_embedding(teks_embed)
        if vektor is None:
            return jsonify({"error": "Gagal re-generate embedding. HuggingFace tidak merespons."}), 503

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


@app.route('/api/import', methods=['POST'])
@login_required
def import_data():
    """Import bulk data dari file JSON."""
    validate_csrf_token()

    if 'file' not in request.files:
        # Coba dari raw JSON body
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

    # Validasi semua data dulu
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

    # Proses insert
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
                    "SELECT id FROM data_mobil_hybrid WHERE tipe_mobil = %s AND varian = %s",
                    (tipe, varian)
                )
                if cur.fetchone():
                    results["dilewati"] += 1
                    results["details"].append(f"'{tipe} {varian}': sudah ada di database")
                    continue

            # Generate embedding
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

            time.sleep(0.5)  # Rate limit HuggingFace

        return jsonify({
            "success": True,
            "message": f"Import selesai: {results['berhasil']} berhasil, {results['dilewati']} dilewati, {results['gagal']} gagal.",
            "results": results
        })
    finally:
        conn.close()


# --- Pydantic Schema untuk Ekstraksi Brosur via Gemini ---
class VariantListItem(BaseModel):
    tipe_mobil: str = Field(description="Nama tipe mobil utama secara formal, contoh: Toyota All New Avanza")
    varian: str = Field(description="Nama varian spesifik secara formal, contoh: 1.5 G CVT")
    harga: str = Field(description="Harga mobil dalam format angka rupiah dipisah titik, contoh: 1.355.000.000. Jika tidak ada di brosur, kosongkan.")
    est_bbm_kota: str = Field(description="Konsumsi BBM dalam kota, format: X km/l (misal: 7 km/l). Jika tidak ada di brosur, estimasi secara wajar atau kosongkan.")
    est_bbm_tol: str = Field(description="Konsumsi BBM tol/luar kota, format: Y km/l (misal: 10 km/l). Jika tidak ada di brosur, estimasi secara wajar atau kosongkan.")

class VariantListResponse(BaseModel):
    variants: list[VariantListItem] = Field(description="Daftar seluruh tipe dan varian mobil Toyota yang ditemukan di brosur.")

class CarSpecification(BaseModel):
    segmentation: str = Field(description="Segmentasi mobil, misal: MPV Premium / Luxury Minivan")
    performance_specs: str = Field(description="Penjelasan detail performa, mesin, tenaga, torsi, transmisi")
    fuel_system_capacity_efficiency_estimates: str = Field(description="Kapasitas tangki, sistem bahan bakar, efisiensi estimasi, serta informasi detail klaim garansi (seperti garansi baterai hybrid 8 Tahun atau 160.000 KM, garansi mesin, dll) jika terdapat informasi garansi tersebut di dalam brosur. Khusus untuk mobil listrik (BEV/EV) atau plug-in hybrid (PHEV), kolom ini WAJIB mencantumkan kapasitas baterai (Battery Capacity dalam kWh) dan jarak tempuh maksimal (Range Up To dalam km) dengan format penulisan yang jelas.")
    dimensions: str = Field(description="Panjang, lebar, tinggi, wheelbase, kapasitas penumpang")
    colour_option: str = Field(description="Pilihan warna, dipisahkan koma")
    chassis_drivetrain: str = Field(description="Kemudi, suspensi, pengereman, velg, ban. Jika brosur mencantumkan platform TNGA (Toyota New Global Architecture), WAJIB masukkan di bagian ini dengan contoh penulisan: 'Dibangun di atas platform TNGA (Toyota New Global Architecture) yang merupakan desain terbaru Toyota untuk menghadirkan performa akselerasi terbaik (Best Performance/Acceleration), kenyamanan dan stabilitas terbaik (Best Comfort & Stability), efisiensi bahan bakar yang lebih baik (Improved Fuel Efficiency), serta kabin yang lebih senyap (Quieter Cabin).' Sesuaikan dengan informasi yang tertera di brosur.")
    exterior: str = Field(description="Detail eksterior, lampu, grille, pintu")
    interior_comfort: str = Field(description="Detail jok, setir, AC, kenyamanan kabin")
    technology: str = Field(description="TFT digital meter, head unit, speaker, konektivitas, wireless charger. Jika brosur mencantumkan fitur konektivitas T Intouch (mTOYOTA), WAJIB masukkan di bagian ini dengan format penulisan contoh: 'Dilengkapi fitur konektivitas T Intouch (mTOYOTA) yang mencakup: Find My Car (mengetahui lokasi kendaraan diparkir secara akurat untuk memberikan rasa aman dan kenyamanan), Stolen Vehicle Tracking (mengetahui lokasi kendaraan yang dicuri dengan bantuan Toyota Call Center untuk memberikan keamanan setiap saat), Geofencing (memberikan peringatan ketika kendaraan berada di luar zona yang diizinkan untuk memastikan keamanan setiap saat), Vehicle Info (memberikan informasi kondisi kendaraan dan notifikasi peringatan untuk kenyamanan saat berkendara), Guest Driver Alert (mengaktifkan notifikasi khusus seperti Radius Jarak, Kecepatan Maksimum, dan Waktu Idle Maksimum saat memperbolehkan pengemudi lain menggunakan kendaraan, misal: Valet Parking), Speed & Idle Alert (notifikasi saat kendaraan melebihi batas kecepatan atau durasi mesin idle sesuai preferensi), Time Fencing (notifikasi saat kendaraan digunakan/mesin menyala dalam rentang waktu tertentu sesuai preferensi), Driving Report (ringkasan sesi berkendara melalui laporan harian dan bulanan), Inquiry & Support Center (bantuan langsung dari Toyota Call Center untuk menyelesaikan masalah dan memberi kemudahan), Emergency Road Assistance (tombol SOS jika mengalami kecelakaan, akan dibantu Toyota Call Center dan diarahkan ke penyedia Emergency Road Assistance/ERA).' Sesuaikan fitur yang disebutkan dengan apa yang tertera di brosur — jangan tambahkan fitur yang tidak ada di brosur.")
    safety_specs: str = Field(description="Fitur keselamatan pasif dan aktif. WAJIB menuliskan kepanjangan dari setiap singkatan fitur keselamatan yang terdeteksi di brosur, contoh: TSS (Toyota Safety Sense), PVM (Panoramic View Monitor), BSM (Blind Spot Monitor), RCTA (Rear Cross Traffic Alert), PCS (Pre-Collision System), LDA (Lane Departure Alert), airbag, dll.")

class CarDataResponse(BaseModel):
    tipe_mobil: str = Field(description="Nama tipe mobil utama secara formal, contoh: Toyota All New Alphard")
    varian: str = Field(description="Nama varian spesifik secara formal, contoh: 2.5 XE (Gasoline)")
    harga: str = Field(description="Harga mobil dalam format angka rupiah dipisah titik, contoh: 1.355.000.000. Jika tidak ada di brosur, kosongkan.")
    est_bbm_kota: str = Field(description="Konsumsi BBM dalam kota, format: X km/l (misal: 7 km/l). Jika tidak ada di brosur, estimasi secara wajar atau kosongkan.")
    est_bbm_tol: str = Field(description="Konsumsi BBM tol/luar kota, format: Y km/l (misal: 10 km/l). Jika tidak ada di brosur, estimasi secara wajar atau kosongkan.")
    spesifikasi: CarSpecification

class CarListResponse(BaseModel):
    cars: list[CarDataResponse] = Field(description="Daftar seluruh model dan varian mobil Toyota yang ditemukan di brosur.")


@app.route('/api/extract-brochure', methods=['POST'])
@login_required
def extract_brochure():
    """Ekstrak brosur PDF/Image/TXT menggunakan multimodal Gemini."""
    validate_csrf_token()

    if 'file' not in request.files:
        return jsonify({"error": "File tidak ditemukan dalam request."}), 400

    file = request.files['file']
    if not file.filename:
        return jsonify({"error": "Nama file kosong."}), 400

    # Tentukan mime type
    filename_lower = file.filename.toLowerCase() if hasattr(file.filename, 'toLowerCase') else file.filename.lower()
    
    if filename_lower.endswith('.pdf'):
        mime_type = 'application/pdf'
    elif filename_lower.endswith('.png'):
        mime_type = 'image/png'
    elif filename_lower.endswith(('.jpg', '.jpeg')):
        mime_type = 'image/jpeg'
    elif filename_lower.endswith(('.txt', '.text')):
        mime_type = 'text/plain'
    else:
        return jsonify({"error": "Format file tidak didukung. Gunakan PDF, PNG, JPG, atau TXT."}), 400

    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        return jsonify({"error": "GOOGLE_API_KEY tidak dikonfigurasi di server backend."}), 500

    try:
        file_bytes = file.read()
        if not file_bytes:
            return jsonify({"error": "File kosong."}), 400

        print(f"[Gemini OCR] Memproses file '{file.filename}' dengan size {len(file_bytes)} bytes...")
        
        client = genai.Client(api_key=api_key)
        
        prompt = (
            "Anda adalah asisten data Auto2000. Tugas Anda adalah menganalisis brosur mobil Toyota terlampir (bisa teks, gambar, atau halaman PDF) "
            "dan mengekstrak seluruh tipe atau varian mobil (bisa lebih dari satu mobil) yang tertera di dalam dokumen tersebut ke dalam format skema JSON yang ditentukan. "
            "Pastikan membedakan antara tipe bensin, diesel, hybrid, dan listrik (BEV/EV), serta variasi tipe bodi atau grade yang berbeda. "
            "SANGAT PENTING: Gunakan NAMA VARIAN AKTUAL tepat seperti yang tertulis di baris nama spesifik brosur (misal: '1.5 G M/T' atau '1.5 G CVT' atau '1.5 S HEV eCVT'). JANGAN pernah mengubah singkatan tipe atau memperpanjangnya (seperti mengubah '1.5 G M/T' menjadi '1.5 Gasoline M/T'). "
            "Pastikan semua field spesifikasi terisi secara mendetail berdasarkan informasi yang ada di brosur. "
            "ATURAN PENULISAN FITUR: 1) Jika tidak ada fitur pada varian mobil itu, JANGAN tuliskan seperti 'Fitur Rear Parking Camera tidak include'. Jika memang tidak ada, maka JANGAN DITULIS sama sekali. "
            "2) Jika ada kemiripan nama, jangan digabungkan. Contoh: 'Rear Parking Sensor & Camera' jangan ditulis begitu, melainkan pisahkan menjadi 'Rear Parking Sensor dan Rear Parking Camera'. "
            "Khusus untuk field safety_specs, jika mobil memiliki sistem Toyota Safety Sense (TSS) atau sistem keselamatan aktif lainnya, berikan penjelasan ringkas mengenai fungsionalitas fiturnya secara eksplisit (seperti: sensor deteksi kantuk / Driver Monitor, sistem mobil berhenti otomatis/menepi jika pengemudi tidak responsif / EDSS, pencegah tabrakan / PCS, dll) agar dapat dideteksi oleh pencarian semantik chatbot nantinya. "
            "Khusus untuk mobil listrik (BEV/EV) atau plug-in hybrid (PHEV), Anda WAJIB menyertakan kapasitas baterai (Battery Capacity) dan jarak tempuh maksimal (Range Up To) di bagian fuel_system_capacity_efficiency_estimates. "
            "Jika ada informasi yang benar-benar tidak tercantum di brosur, berikan estimasi wajar atau kosongkan secara elegan."
        )

        # Logika khusus untuk PDF: Hybrid Native + OCR (Hanya Halaman Spesifikasi yang Di-OCR)
        if mime_type == 'application/pdf':
            print("[Gemini OCR] Menjalankan Hybrid Native + OCR Extraction Pipeline untuk PDF...")
            native_text = ""
            ocr_text = ""
            
            try:
                doc = fitz.open(stream=file_bytes, filetype="pdf")
                spec_pages = []
                
                # Step 1: Scan halaman & ekstrak teks native, sambil mendeteksi letak tabel spesifikasi
                for i, page in enumerate(doc):
                    text = page.get_text()
                    if text.strip():
                        native_text += f"\n--- NATIVE PAGE {i+1} ---\n{text}"
                    
                    # Deteksi kata kunci yang menandakan halaman tabel spesifikasi
                    if any(k in text.lower() for k in ["spesifikasi", "specifications", "transmisi", "diameter x langkah", "final gear ratio"]):
                        spec_pages.append(i)
                
                print(f"[Gemini OCR] Halaman spesifikasi terdeteksi pada indeks: {spec_pages}")
                if not spec_pages:
                    # Default ke halaman terakhir jika tidak terdeteksi
                    spec_pages = [len(doc) - 1]
                    print(f"[Gemini OCR] Kata kunci tidak terdeteksi, default ke halaman terakhir: {spec_pages}")
                
                # Step 2: Jalankan OCR secara visual HANYA pada halaman spesifikasi yang terdeteksi
                for page_idx in spec_pages:
                    page = doc[page_idx]
                    pix = page.get_pixmap(dpi=150)
                    img_bytes = pix.tobytes("png")
                    
                    print(f"[Gemini OCR] Melakukan OCR khusus Halaman Spesifikasi {page_idx + 1}...")
                    ocr_prompt = (
                        "Ekstrak semua teks yang terlihat di gambar halaman brosur ini secara berurutan kolom demi kolom (dari kiri ke kanan). "
                        "Sangat penting untuk mempertahankan hubungan vertikal tabel: sebutkan header kolom tingkat atas (misal: GASOLINE atau HYBRID) "
                        "dan tipe kelas (G Type, S Type, dll) untuk setiap nama varian spesifik (misal: 1.5 G M/T, 1.5 G CVT, 1.5 S HEV eCVT). "
                        "Tuliskan isi tabel spesifikasi teknis, dimensi, tipe mesin, transmisi, sasis, ban, dan fitur keselamatan secara detail dan rapi tanpa penjelasan tambahan."
                    )
                    ocr_resp = client.models.generate_content(
                        model="gemini-3.1-flash-lite",
                        contents=[
                            types.Part.from_bytes(data=img_bytes, mime_type="image/png"),
                            ocr_prompt
                        ]
                    )
                    if ocr_resp.text:
                        ocr_text += f"\n--- OCR SPEC PAGE {page_idx + 1} ---\n{ocr_resp.text}"
                        
            except Exception as pdf_err:
                print(f"[Gemini OCR] Gagal pre-processing PDF dengan PyMuPDF: {pdf_err}")
                native_text = ""
                ocr_text = ""

            if native_text or ocr_text:
                combined_source_text = f"=== NATIVE TEXT ===\n{native_text}\n\n=== OCR TEXT ===\n{ocr_text}"
                
                # ------------------ STAGE 1: Ekstrak Daftar Varian Ringan ------------------
                print("[Gemini OCR] STAGE 1: Mengekstrak daftar varian mobil secara dinamis...")
                list_prompt = (
                    "Tugas Anda adalah membaca teks brosur mobil di bawah ini dan mencantumkan seluruh tipe/varian mobil Toyota yang ditemukan "
                    "beserta harganya (jika ada) dan konsumsi BBM estimasi.\n"
                    "SANGAT PENTING:\n"
                    "1. Analisis baris header kolom spesifikasi bertingkat secara saksama. Kolom spesifikasi sering bertingkat, misalnya:\n"
                    "   - Baris 1 (Kategori): GASOLINE / HYBRID\n"
                    "   - Baris 2 (Tipe): G Type / S Type\n"
                    "   - Baris 3 (Nama Varian Aktual): 1.5 G M/T, 1.5 G CVT, 1.5 S CVT, 1.5 S CVT with GR Parts Aero Package, 1.5 G HEV eCVT, 1.5 S HEV eCVT, 1.5 S HEV eCVT with GR Parts Aero Package.\n"
                    "2. Cari dan cantumkan SETIAP kolom varian secara terpisah sebagai entri mandiri di JSON. Jangan pernah menggabungkan atau melewatkan varian! Jika tabel memiliki 7 kolom varian, maka Anda wajib menghasilkan tepat 7 entri varian di JSON.\n"
                    "3. Gunakan NAMA VARIAN AKTUAL tepat seperti yang tertulis di brosur pada Baris 3. JANGAN mengganti atau memperpanjang singkatan tipe (misal: jangan mengubah '1.5 G M/T' menjadi '1.5 Gasoline M/T' atau '1.5 Gasoline G M/T'). Tetap gunakan nama varian seperti '1.5 G M/T' atau '1.5 S CVT'.\n"
                    "4. Pastikan tipe_mobil formal (misal: Toyota All New Yaris Cross) dan nama varian spesifik (misal: 1.5 G M/T atau 1.5 S HEV eCVT dengan GR Parts Aero Package).\n"
                    "5. SANGAT PENTING: Jangan hanya melihat baris Header atas! Periksa juga baris 'Sistem Penggerak / Drive System'. Jika sebuah kolom (misal: '2.8 VRZ') memiliki keterangan '2WD & 4WD' atau '4x2 & 4x4' di baris penggeraknya, maka kolom tersebut menyimpan DUA varian berbeda. Anda WAJIB memecah/menduplikasinya menjadi 2 entri yang berbeda: satu bernama '2.8 VRZ' dan satu lagi bernama '2.8 VRZ 4x4'."
                )
                
                variants_data = []
                try:
                    response_list = client.models.generate_content(
                        model="gemini-3.1-flash-lite",
                        contents=[
                            combined_source_text,
                            list_prompt
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=VariantListResponse,
                            temperature=0.1
                        )
                    )
                    variants_data = json.loads(response_list.text).get("variants", [])
                except Exception as list_err:
                    print(f"[Gemini OCR] Gagal pada STAGE 1 (listing): {list_err}")

                if variants_data:
                    print(f"[Gemini OCR] STAGE 1 Sukses! Menemukan {len(variants_data)} varian. Memulai STAGE 2...")
                    
                    # ------------------ STAGE 2: Ekstrak Spesifikasi Masing-Masing Varian ------------------
                    final_cars = []
                    for idx, var in enumerate(variants_data):
                        print(f"[Gemini OCR] [{idx+1}/{len(variants_data)}] Menghasilkan spesifikasi untuk: {var.get('tipe_mobil')} {var.get('varian')}...")
                        spec_prompt = (
                            f"Berdasarkan teks brosur di bawah ini, ekstrak spesifikasi teknis mendetail khusus untuk mobil:\n"
                            f"Tipe: {var.get('tipe_mobil')}\n"
                            f"Varian: {var.get('varian')}\n\n"
                            "ATURAN SANGAT PENTING DALAM MENENTUKAN FITUR VARIAN:\n"
                            "Brosur sering mencantumkan label kepemilikan fitur dalam tanda kurung, contoh: '(All Type)', '(All Type, Exclude G Type)', '(4x4 GR Sport Type)', atau '(Black for 4x4 VRZ Type & Body Color for 4x4 GR Sport Type)'.\n"
                            "Patuhi aturan pencocokan berikut secara ketat:\n"
                            f"1. Jika suatu fitur ditandai dengan 'Exclude [Nama Varian]' atau 'Kecuali Tipe [Nama Varian]' (contoh: 'Exclude G Type'), dan varian yang sedang diekstrak saat ini adalah varian tersebut (varian saat ini: {var.get('varian')}), maka Anda DILARANG KERAS memasukkan fitur tersebut ke dalam spesifikasi varian ini! (Contoh: RSE tertulis 'Exclude G Type', maka untuk tipe G, RSE harus ditulis TIDAK ADA / tidak dimasukkan).\n"
                            f"2. Jika suatu fitur ditandai khusus untuk tipe tertentu (contoh: '(4x4 GR Sport Type)'), dan varian yang sedang diekstrak saat ini bukan tipe tersebut (varian saat ini: {var.get('varian')}), maka fitur tersebut DILARANG dimasukkan ke varian ini.\n"
                            "3. Jika suatu fitur ditandai '(All Type)' atau '(Semua Varian)', maka masukkan ke semua varian.\n"
                            "4. Lakukan pencocokan secara logis, jangan berasumsi atau menyamaratakan fitur kelas atas (seperti TSS, RSE, GR parts, panoramic view) ke semua varian jika brosur memberi batasan tipe.\n"
                            "5. SANGAT PENTING: Jika tidak ada fitur pada varian mobil itu, JANGAN tuliskan seperti 'Fitur Rear Parking Camera tidak include'. Jika memang tidak ada, maka JANGAN DITULISKAN sama sekali.\n"
                            "6. SANGAT PENTING: Penulisan fitur, jika ada kemiripan nama jangan digabungkan. Seperti 'Rear Parking Sensor & Camera' jangan buat seperti itu, buat satu-satu, contoh 'Rear Parking Sensor dan Rear Parking Camera'. Ini yang benar.\n"
                            "7. Wajib tuliskan kapasitas penumpang di bagian dimension. Jika tidak tercantum di brosur, gunakan pengetahuan internal Anda (internal knowledge) untuk mengisi kapasitas penumpang yang sesuai.\n"
                            "8. Wajib tambahkan jenis sistem penggerak roda (contoh: FWD, RWD, AWD, 4x4) di bagian performance_specs. Jika tidak tercantum di brosur, gunakan pengetahuan internal Anda.\n"
                            "9. Di bagian performance_specs, jika mobil tersebut menggunakan mesin bensin (gasoline), wajib tambahkan tulisan 'Mesin Bensin <tipe/kapasitas mesin>'. Jika menggunakan mesin diesel, tambahkan 'Mesin Diesel <tipe/kapasitas mesin>'.\n"
                            "10. Di bagian performance_specs, untuk SEMUA mobil HEV (Hybrid Electric Vehicle) dan varian mobil yang jenis transmisinya tidak dieksplisitkan di brosur, WAJIB tuliskan menggunakan transmisi otomatis e-CVT.\n"
                            "Tuliskan spesifikasi detail tersebut sesuai skema JSON yang ditentukan (CarSpecification). "
                            "Khusus untuk field safety_specs, jika mobil memiliki sistem keselamatan aktif (seperti TSS atau lainnya), jelaskan cara kerja fiturnya secara eksplisit (seperti: sensor deteksi kantuk / Driver Monitor, mobil ngerem sendiri / EDSS, pencegah tabrakan / PCS, dll) agar terbaca chatbot. "
                            "Khusus untuk field technology, jika brosur mencantumkan fitur konektivitas T Intouch (mTOYOTA), masukkan semua fitur T Intouch yang tertera di brosur ke dalam field technology beserta penjelasan fungsinya secara detail. "
                            "Contoh fitur T Intouch beserta penjelasannya: Find My Car (mengetahui lokasi kendaraan diparkir secara akurat), Stolen Vehicle Tracking (melacak lokasi kendaraan dicuri dengan bantuan Toyota Call Center), Geofencing (peringatan jika kendaraan keluar zona yang diizinkan), Vehicle Info (informasi kondisi kendaraan dan notifikasi peringatan), Guest Driver Alert (notifikasi khusus saat orang lain menggunakan kendaraan misal valet parking), Speed & Idle Alert (notifikasi jika melebihi batas kecepatan atau idle terlalu lama), Time Fencing (notifikasi saat kendaraan menyala di rentang waktu tertentu), Driving Report (ringkasan sesi berkendara harian dan bulanan), Inquiry & Support Center (bantuan langsung Toyota Call Center), Emergency Road Assistance/ERA (tombol SOS dan bantuan darurat kecelakaan dari Toyota Call Center). "
                            "Sesuaikan fitur T Intouch yang dituliskan hanya dengan yang tercantum di brosur untuk varian tersebut — jangan menambahkan fitur yang tidak ada di brosur. "
                            "Untuk mobil listrik (BEV/EV) atau plug-in hybrid (PHEV), Anda WAJIB menyertakan kapasitas baterai (Battery Capacity, misal: 71.4 kWh) dan jarak tempuh maksimal (Range Up To, misal: 500 km) di bagian fuel_system_capacity_efficiency_estimates."
                        )
                        
                        try:
                            response_spec = client.models.generate_content(
                                model="gemini-3.1-flash-lite",
                                contents=[
                                    combined_source_text,
                                    spec_prompt
                                ],
                                config=types.GenerateContentConfig(
                                    response_mime_type="application/json",
                                    response_schema=CarSpecification,
                                    temperature=0.1
                                )
                            )
                            spec_json = json.loads(response_spec.text)
                            
                            car_entry = {
                                "tipe_mobil": var.get("tipe_mobil"),
                                "varian": var.get("varian"),
                                "harga": var.get("harga"),
                                "est_bbm_kota": var.get("est_bbm_kota"),
                                "est_bbm_tol": var.get("est_bbm_tol"),
                                "spesifikasi": spec_json
                            }
                            final_cars.append(car_entry)
                        except Exception as spec_err:
                            print(f"[Gemini OCR] Gagal mengambil spesifikasi untuk {var.get('varian')}: {spec_err}")
                    
                    return jsonify({
                        "success": True,
                        "data": final_cars
                    })
                else:
                    # Fallback jika Stage 1 tidak menghasilkan apa-apa
                    print("[Gemini OCR] Stage 1 kosong, menjalankan fallback ke direct multimodal...")
                    response = client.models.generate_content(
                        model="gemini-3.1-flash-lite",
                        contents=[
                            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                            prompt
                        ],
                        config=types.GenerateContentConfig(
                            response_mime_type="application/json",
                            response_schema=CarListResponse,
                            temperature=0.1
                        )
                    )
            else:
                # Fallback jika PyMuPDF gagal total
                print("[Gemini OCR] Fallback ke direct multimodal PDF extraction...")
                response = client.models.generate_content(
                    model="gemini-3.1-flash-lite",
                    contents=[
                        types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                        prompt
                    ],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CarListResponse,
                        temperature=0.1
                    )
                )
        else:
            # Skenario non-PDF (PNG, JPG, TXT)
            contents = [
                types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
                prompt
            ] if mime_type != 'text/plain' else [
                file_bytes.decode('utf-8', errors='replace'),
                prompt
            ]
            
            response = client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=CarListResponse,
                    temperature=0.1
                )
            )

        # Parse response text sebagai JSON
        result_json = json.loads(response.text)
        return jsonify({
            "success": True,
            "data": result_json.get("cars", [])
        })

    except Exception as e:
        print(f"[ERROR] Gagal mengekstrak brosur: {e}")
        return jsonify({"error": f"Gagal memproses brosur: {str(e)}"}), 500



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

        # Format ke struktur import-compatible
        export_list = []
        for row in rows:
            try:
                spek = json.loads(row['spesifikasi_detail']) if isinstance(row['spesifikasi_detail'], str) else row['spesifikasi_detail']
            except (json.JSONDecodeError, TypeError):
                spek = {}

            # Format harga dengan titik separator
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

        # Generate filename
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

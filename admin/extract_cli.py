"""
========================================================================================
CLI TOOL: EKSTRAKSI BROSUR MOBIL TOYOTA & INGESTION KE TIDB SERVERLESS
========================================================================================
Menggunakan:
  - Google Gemini 3.1 Flash Lite (Multimodal OCR & Structured JSON Schema)
  - Hugging Face Space BAE/bge-m3 (1024-Dimension Dense Vector Embedding)
  - TiDB Serverless (Relational + Native Vector Database)

PANDUAN PENGGUNAAN CEPAT:

1. Ekstrak 1 brosur dan simpan ke file JSON (untuk dicek terlebih dahulu):
   python extract_cli.py "browsur toyota/commercial/hilux d & s cub.pdf" --output hilux.json

2. Ekstrak 1 brosur dan LANGSUNG simpan ke database TiDB + Vector Embedding:
   python extract_cli.py "browsur toyota/commercial/hilux d & s cub.pdf" --save-db

3. Ekstrak 1 brosur, simpan ke JSON DAN sekaligus simpan ke database TiDB:
   python extract_cli.py "browsur toyota/commercial/hilux d & s cub.pdf" --output hilux.json --save-db

4. Ekstrak SELURUH brosur di dalam sebuah folder sekaligus (Batch Ingestion):
   python extract_cli.py --dir "browsur toyota/commercial" --save-db

5. Melihat semua opsi bantuan:
   python extract_cli.py --help
========================================================================================
"""

import os
import sys
import json
import argparse
from typing import List, Optional
import fitz  # PyMuPDF
import pymysql
import certifi
from dotenv import load_dotenv
from google import genai
from google.genai import types
from pydantic import BaseModel, Field
from gradio_client import Client

# Reconfigure stdout/stderr agar aman di Windows PowerShell/CMD (UTF-8)
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8', errors='replace')

# --- SETUP ENVIRONMENT VARIABLES ---
# Load .env sama persis seperti admin_server.py
file_dir = os.path.dirname(os.path.abspath(__file__))
parent_dir = os.path.dirname(file_dir)
grandparent_dir = os.path.dirname(parent_dir)

env_candidates = [
    os.path.join(parent_dir, 'toyotarantauprapat', '.env'),
    os.path.join(grandparent_dir, 'toyotarantauprapat', '.env'),
    os.path.join(file_dir, 'toyotarantauprapat', '.env'),
    os.path.join(parent_dir, '.env'),
    os.path.join(file_dir, '.env'),
]

for p in env_candidates:
    if os.path.exists(p):
        load_dotenv(dotenv_path=p, override=False)

load_dotenv()  # Fallback default

# --- Pydantic Schema untuk Ekstraksi Terstruktur Gemini ---
class CarSpecification(BaseModel):
    segmentation: str = Field(description="Segmentasi mobil, misal: MPV Premium / Luxury Minivan / Compact SUV")
    performance_specs: str = Field(description="Penjelasan detail performa, mesin, tenaga, torsi, transmisi, sistem penggerak roda FWD/RWD/AWD/4x4")
    fuel_system_capacity_efficiency_estimates: str = Field(description="Kapasitas tangki, efisiensi BBM, serta garansi atau kapasitas baterai kWh jika EV/PHEV")
    dimensions: str = Field(description="Panjang, lebar, tinggi, wheelbase, kapasitas penumpang (misal: 7 orang / 7-seater)")
    colour_option: str = Field(description="Pilihan warna, dipisahkan koma")
    chassis_drivetrain: str = Field(description="Kemudi, suspensi, pengereman, velg, ban, platform TNGA jika ada")
    exterior: str = Field(description="Detail eksterior, lampu, grille, pintu, antena")
    interior_comfort: str = Field(description="Detail jok, setir, AC, kenyamanan kabin, captain seat")
    technology: str = Field(description="Head unit, TFT digital meter, wireless charger, konektivitas T Intouch jika ada")
    safety_specs: str = Field(description="Fitur keselamatan aktif & pasif (TSS, airbag, PVM/kamera 360, BSM, RCTA, dll)")

class VariantListItem(BaseModel):
    tipe_mobil: str = Field(description="Nama tipe mobil formal, contoh: Toyota All New Yaris Cross")
    varian: str = Field(description="Nama varian spesifik secara formal, contoh: 1.5 S HEV eCVT with GR Parts Aero Package")
    harga: str = Field(description="Harga mobil angka rupiah, contoh: 449.950.000 (jika ada)")
    est_bbm_kota: str = Field(description="Konsumsi BBM dalam kota, format: X km/l")
    est_bbm_tol: str = Field(description="Konsumsi BBM tol/luar kota, format: Y km/l")

class VariantListResponse(BaseModel):
    variants: List[VariantListItem]

# --- Helper: Hugging Face BGE-M3 Embedding ---
_hf_client = None

def get_hf_client():
    global _hf_client
    if _hf_client is None:
        try:
            _hf_client = Client("Ikiiloh/RAG-CAR", httpx_kwargs={"timeout": 120.0})
        except Exception as e:
            print(f"[ERROR] Gagal menginisialisasi HuggingFace Client: {e}")
            return None
    return _hf_client

def get_embedding(text: str):
    """Menghitung representasi vektor 1024-dimensi menggunakan BGE-M3."""
    client = get_hf_client()
    if not client:
        return None
    try:
        result = client.predict(text=text, api_name="/on_click")
        if isinstance(result, tuple):
            return result[0]
        return result
    except Exception as e:
        print(f"[ERROR] Gagal menghitung embedding: {e}")
        return None

# --- Helper: Koneksi TiDB ---
def get_db_connection():
    return pymysql.connect(
        host=os.getenv("TIDB_HOST"),
        user=os.getenv("TIDB_USER"),
        password=os.getenv("TIDB_PASSWORD"),
        database=os.getenv("TIDB_NAME", "test"),
        port=int(os.getenv("TIDB_PORT", 4000)),
        ssl_verify_cert=True,
        ssl_ca=certifi.where(),
        charset='utf8mb4',
        cursorclass=pymysql.cursors.DictCursor
    )

# --- Ekstraksi Dokumen Menggunakan Gemini Multimodal ---
def extract_brochure_file(file_path: str):
    """Ekstraksi teks brosur (PDF, Gambar, atau TXT) menjadi list objek mobil terstruktur."""
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        print("[ERROR] GOOGLE_API_KEY tidak ditemukan di .env!")
        sys.exit(1)

    client = genai.Client(api_key=api_key)
    filename = os.path.basename(file_path)
    filename_lower = filename.lower()

    if filename_lower.endswith('.pdf'):
        mime_type = 'application/pdf'
    elif filename_lower.endswith('.png'):
        mime_type = 'image/png'
    elif filename_lower.endswith(('.jpg', '.jpeg')):
        mime_type = 'image/jpeg'
    elif filename_lower.endswith(('.txt', '.text')):
        mime_type = 'text/plain'
    else:
        print(f"[ERROR] Format file '{filename}' tidak didukung. Gunakan PDF, PNG, JPG, atau TXT.")
        return []

    print(f"\n[FILE] Memproses file: {filename}")
    with open(file_path, "rb") as f:
        file_bytes = f.read()

    # Logika Khusus PDF: Scan Halaman Spesifikasi & Visual OCR
    if mime_type == 'application/pdf':
        native_text = ""
        ocr_text = ""
        spec_pages = []

        try:
            doc = fitz.open(stream=file_bytes, filetype="pdf")
            print(f"[PDF] Jumlah halaman: {len(doc)}")
            
            for i, page in enumerate(doc):
                text = page.get_text()
                if text.strip():
                    native_text += f"\n--- NATIVE PAGE {i+1} ---\n{text}"
                if any(k in text.lower() for k in ["spesifikasi", "specifications", "transmisi", "dimensi", "mesin", "diameter x langkah"]):
                    spec_pages.append(i)

            if not spec_pages:
                spec_pages = [len(doc) - 1]

            print(f"[OCR] Menjalankan visual OCR Gemini pada halaman spesifikasi: {[p+1 for p in spec_pages]}...")
            for p_idx in spec_pages:
                pix = doc[p_idx].get_pixmap(dpi=150)
                img_bytes = pix.tobytes("png")
                ocr_prompt = (
                    "Ekstrak semua teks tabel spesifikasi teknis mobil di gambar ini secara berurutan kolom demi kolom. "
                    "Sebutkan header varian (misal: GASOLINE vs HYBRID, G Type vs S Type) untuk setiap varian."
                )
                ocr_resp = client.models.generate_content(
                    model="gemini-3.1-flash-lite",
                    contents=[types.Part.from_bytes(data=img_bytes, mime_type="image/png"), ocr_prompt]
                )
                if ocr_resp.text:
                    ocr_text += f"\n--- OCR SPEC PAGE {p_idx + 1} ---\n{ocr_resp.text}"

        except Exception as err:
            print(f"[WARN] PyMuPDF gagal memproses halaman spesifikasi: {err}")

        combined_text = f"=== NATIVE TEXT ===\n{native_text}\n\n=== OCR TEXT ===\n{ocr_text}"

        # STAGE 1: List Seluruh Varian
        print("[STAGE 1] Mengekstrak daftar seluruh varian mobil...")
        list_prompt = (
            "Baca teks brosur mobil di bawah ini dan cantumkan SELURUH tipe/varian mobil Toyota yang ditemukan "
            "beserta harganya (jika ada) dan konsumsi BBM estimasi.\n"
            "Gunakan NAMA VARIAN AKTUAL tepat seperti yang tertulis di brosur (misal: '1.5 G M/T', '1.5 G CVT', '1.5 S HEV eCVT'). "
            "Jika baris sistem penggerak menyebutkan '2WD & 4WD' atau '4x2 & 4x4' pada satu kolom, pecah menjadi dua entri (misal: '2.8 VRZ' dan '2.8 VRZ 4x4')."
        )
        
        try:
            resp_list = client.models.generate_content(
                model="gemini-3.1-flash-lite",
                contents=[combined_text, list_prompt],
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=VariantListResponse,
                    temperature=0.1
                )
            )
            variants_data = json.loads(resp_list.text).get("variants", [])
        except Exception as e:
            print(f"[ERROR] Stage 1 gagal: {e}")
            variants_data = []

        if not variants_data:
            print("[WARN] Tidak ada varian yang ditemukan dari Stage 1.")
            return []

        print(f"[OK] Ditemukan {len(variants_data)} varian mobil!")

        # STAGE 2: Ekstrak Spesifikasi Detail Masing-Masing Varian
        final_cars = []
        for idx, var in enumerate(variants_data):
            tipe = var.get("tipe_mobil")
            varian = var.get("varian")
            print(f"[STAGE 2] [{idx+1}/{len(variants_data)}] Mengekstrak spesifikasi: {tipe} {varian}...")

            spec_prompt = (
                f"Berdasarkan teks brosur di bawah ini, ekstrak spesifikasi teknis mendetail khusus untuk mobil:\n"
                f"Tipe: {tipe}\n"
                f"Varian: {varian}\n\n"
                "ATURAN PENTING FITUR:\n"
                "1. Jika fitur tertulis 'Exclude [Nama Varian]' (misal: 'Exclude G Type'), dan varian ini adalah varian tersebut, DILARANG memasukkan fitur tersebut!\n"
                "2. Jika fitur tidak ada pada varian ini, JANGAN DITULIS sama sekali.\n"
                "3. Pisahkan penulisan fitur (contoh: 'Rear Parking Sensor dan Rear Parking Camera').\n"
                "4. Wajib tuliskan kapasitas penumpang di dimensi (misal: 7 orang / 7-seater).\n"
                "5. Wajib tuliskan sistem penggerak roda (FWD, RWD, AWD, 4x4) dan jenis mesin di performance_specs.\n"
                "6. Untuk mobil HEV / transmisi otomatis, sebutkan transmisi otomatis e-CVT jika transmisi tidak dieksplisitkan.\n"
                "7. Jika terdapat sistem keselamatan (TSS, dll), jelaskan fungsi fiturnya secara eksplisit agar terbaca semantic search."
            )

            try:
                resp_spec = client.models.generate_content(
                    model="gemini-3.1-flash-lite",
                    contents=[combined_text, spec_prompt],
                    config=types.GenerateContentConfig(
                        response_mime_type="application/json",
                        response_schema=CarSpecification,
                        temperature=0.1
                    )
                )
                spec_json = json.loads(resp_spec.text)
                final_cars.append({
                    "tipe_mobil": tipe,
                    "varian": varian,
                    "harga": var.get("harga", ""),
                    "est_bbm_kota": var.get("est_bbm_kota", "0 km/l"),
                    "est_bbm_tol": var.get("est_bbm_tol", "0 km/l"),
                    "spesifikasi": spec_json
                })
            except Exception as spec_err:
                print(f"[ERROR] Gagal mengekstrak spesifikasi untuk {varian}: {spec_err}")

        return final_cars

    else:
        # File gambar atau teks langsung
        print("[IMAGE/TEXT] Memproses file gambar/teks...")
        prompt = "Ekstrak seluruh model dan varian mobil Toyota pada dokumen ini secara detail sesuai skema JSON."
        contents = [
            types.Part.from_bytes(data=file_bytes, mime_type=mime_type),
            prompt
        ] if mime_type != 'text/plain' else [file_bytes.decode('utf-8', errors='replace'), prompt]

        resp = client.models.generate_content(
            model="gemini-3.1-flash-lite",
            contents=contents,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=VariantListResponse,
                temperature=0.1
            )
        )
        return json.loads(resp.text).get("variants", [])

# --- Penyimpanan ke TiDB Serverless ---
def save_cars_to_tidb(cars_data: List[dict]):
    """Menyimpan data mobil dan menghitung vektor embedding ke TiDB."""
    if not cars_data:
        print("[INFO] Tidak ada data untuk disimpan.")
        return

    conn = get_db_connection()
    inserted_count = 0
    skipped_count = 0

    try:
        with conn.cursor() as cur:
            for car in cars_data:
                tipe = car.get("tipe_mobil", "").strip()
                varian = car.get("varian", "").strip()
                if not tipe or not varian:
                    continue

                # 1. Cek duplikasi
                cur.execute(
                    "SELECT id FROM data_mobil_hybrid WHERE LOWER(tipe_mobil) = %s AND LOWER(varian) = %s",
                    (tipe.lower(), varian.lower())
                )
                if cur.fetchone():
                    print(f"[LEWATI] '{tipe} {varian}' sudah ada di database.")
                    skipped_count += 1
                    continue

                # 2. Format spesifikasi
                spek = car.get("spesifikasi", {})
                spek_json = json.dumps(spek, ensure_ascii=False) if isinstance(spek, dict) else str(spek)
                
                # 3. Hitung Vector Embedding
                teks_embed = f"Mobil: {tipe} {varian}. Spesifikasi: {spek_json}"
                print(f"[EMBEDDING BGE-M3] Menghitung vektor untuk '{tipe} {varian}'...")
                vektor = get_embedding(teks_embed)
                if not vektor:
                    print(f"[GAGAL] Gagal mendapatkan embedding untuk '{tipe} {varian}', dilewati.")
                    continue

                vektor_str = str(vektor)

                # 4. Parsing harga dan konsumsi BBM
                harga_clean = car.get("harga", "0").replace(".", "").replace(",", "").replace("Rp", "").strip()
                harga_val = int(harga_clean) if harga_clean.isdigit() else 0
                
                bbm_kota_str = str(car.get("est_bbm_kota", "0")).split()[0]
                bbm_tol_str = str(car.get("est_bbm_tol", "0")).split()[0]
                try:
                    bbm_kota_val = float(bbm_kota_str)
                except ValueError:
                    bbm_kota_val = 0.0
                try:
                    bbm_tol_val = float(bbm_tol_str)
                except ValueError:
                    bbm_tol_val = 0.0

                # 5. Insert ke TiDB
                cur.execute("""
                    INSERT INTO data_mobil_hybrid 
                    (tipe_mobil, varian, harga, bbm_kota, bbm_tol, spesifikasi_detail, embedding)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (tipe, varian, harga_val, bbm_kota_val, bbm_tol_val, spek_json, vektor_str))

                inserted_count += 1
                print(f"[TERSIMPAN] '{tipe} {varian}' (Harga: Rp {harga_val:,}) berhasil masuk TiDB!")

        conn.commit()
        print(f"\n=======================================================")
        print(f"[SELESAI] {inserted_count} varian baru berhasil disimpan, {skipped_count} dilewati.")
        print(f"=======================================================")
    except Exception as err:
        conn.rollback()
        print(f"[ERROR] Transaksi TiDB gagal: {err}")
    finally:
        conn.close()

# --- Main Entrypoint ---
def main():
    parser = argparse.ArgumentParser(
        description="CLI Ekstraksi Brosur Toyota & Vector Ingestion ke TiDB Serverless"
    )
    parser.add_argument("file", nargs="?", help="Path file brosur PDF atau Gambar")
    parser.add_argument("--dir", help="Path direktori/folder berisi kumpulan brosur PDF")
    parser.add_argument("--save-db", action="store_true", help="Langsung simpan hasil dan embedding ke TiDB")
    parser.add_argument("--output", help="Simpan hasil ekstraksi dalam file JSON lokal")

    args = parser.parse_args()

    if not args.file and not args.dir:
        parser.print_help()
        sys.exit(1)

    files_to_process = []
    if args.dir:
        dir_path = args.dir
        if not os.path.isdir(dir_path):
            candidate_dir = os.path.join(parent_dir, args.dir)
            if os.path.isdir(candidate_dir):
                dir_path = candidate_dir
            else:
                print(f"[ERROR] Folder '{args.dir}' tidak ditemukan!")
                sys.exit(1)
        for f in os.listdir(dir_path):
            if f.lower().endswith(('.pdf', '.png', '.jpg', '.jpeg', '.txt')):
                files_to_process.append(os.path.join(dir_path, f))
    elif args.file:
        file_path = args.file
        if not os.path.isfile(file_path):
            candidate_path = os.path.join(parent_dir, args.file)
            if os.path.isfile(candidate_path):
                file_path = candidate_path
            else:
                print(f"[ERROR] File '{args.file}' tidak ditemukan!")
                sys.exit(1)
        files_to_process.append(file_path)

    print(f"[START] Memulai ekstraksi {len(files_to_process)} file brosur...")

    all_extracted_cars = []
    for file_path in files_to_process:
        cars = extract_brochure_file(file_path)
        all_extracted_cars.extend(cars)

    print(f"\n[SUMMARY] Total varian mobil yang berhasil diekstrak: {len(all_extracted_cars)}")

    # Simpan ke JSON jika opsi --output diaktifkan
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(all_extracted_cars, f, ensure_ascii=False, indent=2)
        print(f"[SAVED] File hasil ekstraksi tersimpan di: {args.output}")

    # Simpan ke TiDB jika opsi --save-db diaktifkan
    if args.save_db:
        print("\n[DB INGESTION] Menyimpan seluruh data dan embedding ke TiDB Serverless...")
        save_cars_to_tidb(all_extracted_cars)
    else:
        print("\n[INFO] Data belum disimpan ke database. Tambahkan opsi '--save-db' untuk menyimpan langsung ke TiDB.")

if __name__ == "__main__":
    main()

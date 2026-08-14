import { NextResponse } from "next/server";
import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import mysql from "mysql2/promise";
import { Redis } from "@upstash/redis";

// --- In-Memory Fallback Semaphore: Membatasi concurrent request ke Gemini ---
class MemorySemaphore {
  private queue: (() => void)[] = [];
  private running = 0;

  constructor(private maxConcurrent: number) { }

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    return new Promise<void>((resolve) => {
      this.queue.push(() => {
        this.running++;
        resolve();
      });
    });
  }

  release(): void {
    this.running--;
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      next();
    }
  }

  get status() {
    return { running: this.running, queued: this.queue.length };
  }
}

const localSemaphore = new MemorySemaphore(10);

// --- Upstash Redis Client Initialization ---
const redisUrl = process.env.UPSTASH_REDIS_REST_URL;
const redisToken = process.env.UPSTASH_REDIS_REST_TOKEN;
const isRedisEnabled = !!(redisUrl && redisToken);

let redis: Redis | null = null;
if (isRedisEnabled) {
  redis = new Redis({
    url: redisUrl!,
    token: redisToken!,
  });
  console.log("[Redis] Upstash Redis enabled and initialized.");
} else {
  console.log("[Redis] Upstash credentials missing. Falling back to Local In-Memory Queue (Semaphore).");
}

// --- Helper Functions (ported from prototype's app.py) ---

interface SelfQuery {
  semantic_query: string;
  exact_keywords: string[];
  exclude_keywords: string[];
  budget_min: number | null;
  budget_max: number | null;
  price_sort: "termurah" | "termahal" | "keduanya" | null;
  engine_type: "bensin" | "hybrid" | "ev" | "diesel" | null;
  seats: number | null;
  is_fuel_efficient: boolean;
  is_listing: boolean;
}

// --- Cache untuk daftar nama model dari database ---
let cachedModelAliases: string[] = [];
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 jam

// Prefix umum merek yang perlu dihapus
const STRIP_PREFIXES = /^(toyota\s+)?(all\s+new\s+|new\s+)?/i;

/**
 * Dari nama lengkap di DB, buat semua kombinasi alias (N-grams).
 * @param dynamicBlacklist Kata-kata tunggal yang tidak boleh dijadikan alias karena terlalu umum
 */
function generateAliases(fullName: string, dynamicBlacklist: Set<string>): string[] {
  const stripped = fullName.replace(STRIP_PREFIXES, "").trim();
  if (!stripped) return [fullName];

  const aliases = new Set<string>();
  aliases.add(fullName); // nama lengkap
  aliases.add(stripped); // nama tanpa prefix toyota/new

  const words = stripped.split(/\s+/);

  // Generate semua kombinasi kata berurutan (N-Grams)
  for (let start = 0; start < words.length; start++) {
    for (let end = start + 1; end <= words.length; end++) {
      const phraseWords = words.slice(start, end);
      const phrase = phraseWords.join(" ");

      // Jika hanya 1 kata
      if (phraseWords.length === 1) {
        const wordLower = phrase.toLowerCase();

        // Daftar hitam manual (karena kadang kata "hybrid"/"sport" tidak sengaja masuk ke kolom tipe_mobil di DB)
        const staticBlacklist = ["hybrid", "hev", "ev", "gr", "sport", "gr-s", "mt", "at", "cvt"];

        // Hanya tambahkan jika panjangnya > 2 dan tidak masuk daftar hitam dinamis & statis
        if (wordLower.length > 2 && !dynamicBlacklist.has(wordLower) && !staticBlacklist.includes(wordLower)) {
          aliases.add(phrase);
        }
      } else {
        // Jika 2 kata atau lebih, langsung tambahkan
        aliases.add(phrase);
      }
    }
  }

  return Array.from(aliases);
}

async function fetchModelNames(): Promise<string[]> {
  const now = Date.now();
  if (cachedModelAliases.length > 0 && (now - cacheTimestamp) < CACHE_TTL_MS) {
    return cachedModelAliases;
  }

  let koneksi;
  try {
    koneksi = await getDbConnection();
    const [rows] = await koneksi.execute(
      "SELECT DISTINCT tipe_mobil FROM data_mobil_hybrid"
    );
    const rawModels = (rows as any[])
      .map((r: any) => r.tipe_mobil?.trim().toLowerCase())
      .filter(Boolean);

    // 1. Deteksi Kata Umum Otomatis (Dynamic Blacklist)
    // Kata yang muncul di lebih dari 1 "keluarga mobil" (first word berbeda) dianggap umum.
    const wordToFirstWords = new Map<string, Set<string>>();
    for (const model of rawModels) {
      const stripped = model.replace(STRIP_PREFIXES, "").trim();
      const words = stripped.split(/\s+/);
      const firstWord = words[0]; // Contoh: "yaris", "innova", "corolla"

      for (const w of words) {
        if (!wordToFirstWords.has(w)) wordToFirstWords.set(w, new Set());
        wordToFirstWords.get(w)!.add(firstWord);
      }
    }

    const dynamicBlacklist = new Set<string>();
    for (const [word, firstWordsSet] of wordToFirstWords.entries()) {
      // Jika kata tersebut dipakai oleh 2 keluarga mobil atau lebih (misal "Cross" ada di Yaris & Corolla)
      if (firstWordsSet.size >= 2) {
        dynamicBlacklist.add(word);
      }
    }
    console.log(`[Auto-Blacklist] Kata umum terdeteksi:`, Array.from(dynamicBlacklist));

    // 2. Generate aliases menggunakan blacklist dinamis
    const allAliases = new Set<string>();
    for (const model of rawModels) {
      for (const alias of generateAliases(model, dynamicBlacklist)) {
        allAliases.add(alias);
      }
    }

    cachedModelAliases = Array.from(allAliases);
    cacheTimestamp = now;
    console.log(`[Cache] ${rawModels.length} models → ${cachedModelAliases.length} aliases`);
    return cachedModelAliases;
  } catch (error) {
    console.error("Error fetching model names:", error);
    return cachedModelAliases; // Return stale cache jika ada
  } finally {
    if (koneksi) await koneksi.end();
  }
}

function buildModelRegex(modelNames: string[]): RegExp {
  if (modelNames.length === 0) return /(?!)/gi; // Tidak pernah match

  // Sort by length descending agar nama panjang match duluan
  // misal: "innova zenix hybrid ev" harus match sebelum "innova zenix"
  const sorted = [...modelNames].sort((a, b) => b.length - a.length);

  // Escape karakter regex dan ganti spasi dengan \s+
  const patterns = sorted.map((name) =>
    name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  );

  // Gunakan \b di awal dan akhir grup agar pencocokan nama model bersifat utuh (word boundary)
  return new RegExp(`\\b(?:${patterns.join("|")})\\b`, "gi");
}

function getSpecificModels(teks: string, modelNames: string[]): string[] {
  const modelRegex = buildModelRegex(modelNames);

  const matches = [...teks.matchAll(modelRegex)].map((m) =>
    m[0].toLowerCase().replace(/\s+/g, " ").trim()
  );
  if (matches.length === 0) return [];
  // Return unique matches
  return Array.from(new Set(matches));
}

function parseQueryModels(teks: string, modelNames: string[]): { included: string[], excluded: string[] } {
  const parts = teks.split(/(?:selain|kecuali|exclude)/i);
  if (parts.length < 2) {
    return {
      included: getSpecificModels(teks, modelNames),
      excluded: []
    };
  }
  return {
    included: getSpecificModels(parts[0], modelNames),
    excluded: getSpecificModels(parts.slice(1).join(" "), modelNames)
  };
}

// --- Get TiDB Connection ---
async function getDbConnection() {
  return mysql.createConnection({
    host: process.env.TIDB_HOST,
    user: process.env.TIDB_USER,
    password: process.env.TIDB_PASSWORD,
    database: process.env.TIDB_NAME,
    port: parseInt(process.env.TIDB_PORT || "4000"),
    ssl: {
      rejectUnauthorized: true,
    },
  });
}

// --- Get HuggingFace Embedding ---
// --- In-Memory Embedding Cache for BGE-M3 ---
const embeddingCache = new Map<string, { vector: number[]; timestamp: number }>();
const EMBEDDING_CACHE_TTL_MS = 15 * 60 * 1000; // 15 menit

async function getHuggingFaceEmbedding(
  text: string
): Promise<number[] | null> {
  const cacheKey = text.trim().toLowerCase();
  const now = Date.now();
  const cached = embeddingCache.get(cacheKey);

  if (cached && (now - cached.timestamp) < EMBEDDING_CACHE_TTL_MS) {
    console.log(`[HF Cache Hit] Using cached embedding for: "${cacheKey.substring(0, 30)}..."`);
    return cached.vector;
  }

  try {
    const spaceUrl =
      process.env.HUGGINGFACE_SPACE_URL || "https://ikiiloh-rag-car.hf.space";

    // Gradio v6+ uses /gradio_api prefix instead of /api
    // on_click expects inputs: [text, state] per Gradio config
    const response = await fetch(`${spaceUrl}/gradio_api/call/on_click`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [text, null],
      }),
      signal: AbortSignal.timeout(120000),
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => "");
      console.error(`HuggingFace call failed: ${response.status} ${response.statusText}`, errBody);
      throw new Error(`HuggingFace API error: ${response.status}`);
    }

    const callData = await response.json();
    const eventId = callData.event_id;
    console.log(`[HF] Event ID: ${eventId}`);

    // Fetch SSE result stream
    const resultResponse = await fetch(
      `${spaceUrl}/gradio_api/call/on_click/${eventId}`,
      {
        signal: AbortSignal.timeout(120000),
      }
    );

    if (!resultResponse.ok) {
      throw new Error(`HuggingFace result fetch error: ${resultResponse.status}`);
    }

    const resultText = await resultResponse.text();
    // Parse SSE format - Gradio v6 returns data in SSE stream
    const lines = resultText.split("\n");
    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const jsonData = JSON.parse(line.substring(6));
          if (Array.isArray(jsonData)) {
            // Response is [dense_vector, quota_markdown, explanation_markdown]
            const vector = Array.isArray(jsonData[0]) ? jsonData[0] : jsonData;
            console.log(`[HF] Embedding received, length: ${vector.length}`);
            embeddingCache.set(cacheKey, { vector, timestamp: Date.now() });
            return vector;
          }
        } catch (parseErr) {
          console.error("[HF] Failed to parse SSE data line:", line.substring(0, 100));
        }
      }
    }

    console.error("[HF] No valid embedding found in SSE response");
    return null;
  } catch (error) {
    console.error("Error getting HuggingFace embedding:", error);
    return null;
  }
}

// --- Query Expansion / Query Rewriting
async function rewriteQueryForRAG(message: string, chatHistory: { role: string; content: string }[]): Promise<SelfQuery> {
  const apiKey = process.env.GOOGLE_API_KEY_RAG || process.env.GOOGLE_API_KEY;
  const defaultFallback: SelfQuery = { semantic_query: message, exact_keywords: [], exclude_keywords: [], budget_min: null, budget_max: null, price_sort: null, engine_type: null, seats: null, is_fuel_efficient: false, is_listing: false };
  if (!apiKey) return defaultFallback;

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

    let historyContext = "";
    if (chatHistory && chatHistory.length > 0) {
      // Ambil maksimal 6 pesan terakhir untuk menghemat token dan fokus pada konteks terdekat
      const recentHistory = chatHistory.slice(-6);
      historyContext = "RIWAYAT PERCAKAPAN TERBARU:\n" + recentHistory.map(h => `${h.role === 'user' ? 'Kustomer' : 'Sales Executive'}: "${h.content}"`).join("\n") + "\n\n";
    }

    const systemInstruction = `
      Anda adalah AI Self-Querying Retriever untuk sistem rekomendasi mobil Toyota Auto2000.
      Tugas Anda adalah membedah (parsing) pesan kustomer menjadi objek JSON terstruktur.
      Gunakan RIWAYAT PERCAKAPAN TERBARU sebagai konteks jika kustomer menggunakan kata ganti ("selain itu", "yang termurah").
      
      ATURAN EKSTRAKSI JSON:
      - "semantic_query": Tulis ulang pertanyaan menjadi kata kunci pencarian teknis otomotif (string). JANGAN masukkan harga atau syarat mutlak di sini.
      - "exact_keywords": Array of strings. Jika kustomer meminta fitur HARGA MATI / spesifik, masukkan kata kunci fiturnya ke sini secara spesifik (DILARANG menggabungkan jenis atap yang berbeda fungsi).
         ATURAN PEMISAHAN SPESIFIKASI ATAP KACA:
         - Jika kustomer minta "sunroof", masukkan HANYA ["sunroof"]. (DILARANG memasukkan panoramic atau moonroof).
         - Jika kustomer minta "panoramic" / "panoramic roof" / "panoramic glass roof", masukkan HANYA ["panoramic roof", "panoramic"]. (DILARANG memasukkan sunroof atau moonroof).
         - Jika kustomer minta "moonroof", masukkan HANYA ["moonroof"]. (DILARANG memasukkan sunroof atau panoramic).
         - Jika kustomer minta "atap kaca" (istilah generik), baru boleh memasukkan ["atap kaca", "sunroof", "panoramic", "moonroof"].
         FITUR LAINNYA:
         - Jika kustomer minta "captain seat", masukkan ["captain seat"].
         - Jika kustomer minta "kamera 360", masukkan ["360 camera", "around view", "kamera 360"].
         - Jika kustomer minta "wireless charger" / "cas nirkabel", masukkan ["wireless charger", "cas nirkabel"].
         - DILARANG memasukkan nama model mobil ke sini.
      - "exclude_keywords": Array of strings. Jika kustomer minta "TIDAK MAU X" atau "SELAIN X". Selain itu, jika kustomer mencari mobil penumpang / harian / perkotaan / keluarga, OTOMATIS masukkan kata-kata komersial ke exclude_keywords (contoh: ["truk", "pick up", "pickup", "cab-chs", "komersial"]).
      - "budget_min": Angka murni (number) batas BAWAH harga dalam Rupiah. Jika kustomer bilang "di atas 200 juta", isi 200000000. Jika tidak ada batas bawah, isi null.
      - "budget_max": Angka murni (number) batas ATAS harga dalam Rupiah. Jika kustomer bilang "di bawah 300 juta" atau "budget 300 juta", isi 300000000. Jika tidak ada batas atas, isi null.
      - CATATAN KHUSUS: Jika kustomer bilang "200 jutaan", artinya budget_min = 200000000 dan budget_max = 299999999.
      - "price_sort": "termurah" (HANYA JIKA kustomer EKSPLISIT menggunakan kata "termurah", "paling murah", "terendah" dalam pesan kustomer), "termahal" (HANYA JIKA kustomer EKSPLISIT menggunakan kata "termahal", "paling mahal", "tertinggi"), "keduanya" (HANYA JIKA kustomer EKSPLISIT meminta rentang harga termurah DAN termahal sekaligus). JIKA KUSTOMER TIDAK MENGGUNAKAN KATA "TERMURAH" ATAU "TERMAHAL" DI PESANNYA, WAJIB ISI null!
      - "engine_type": "bensin" (hanya bensin murni), "hybrid" (hanya hybrid/HEV), "ev" (hanya listrik murni/BEV), "diesel" (hanya mesin diesel), atau null (bebas).
      - "seats": 5, 7, 16 (untuk minibus), atau null.
      - "is_fuel_efficient": true (jika mencari mobil irit bbm/hemat/efisien), false jika tidak.
      - "is_listing": true (jika kustomer meminta "apa saja", "daftar", "tampilkan semua"), false jika tidak.

      GLOSARIUM ISTILAH OTOMOTIF UNTUK SEMANTIC QUERY:
      - "CAB-CHS" / "Cab & Chassis" = mobil sasis kosong tanpa bak belakang, siap dipasang bodi karoseri (boks, ambulans, toko keliling, dll).
      - "CAB" / "Kabin" = bagian depan mobil (ruang kemudi sopir dan penumpang).
      - "CHASSIS" / "Sasis" = rangka utama mobil beserta roda dan mesin.
      - "PU" / "Pick Up" = sasis untuk modifikasi angkutan barang.
      - "MB" / "Microbus" / "Motorized Business" / "Mobile Business" = sasis untuk modifikasi angkutan penumpang atau model komersial bergerak.
      - "DSL" = mesin Diesel. Varian tanpa "DSL" berarti Bensin.
      - "PICK UP" (tanpa CAB-CHS) = mobil sudah utuh lengkap dengan bak belakang bawaan pabrik.
      - Jika kustomer menanyakan istilah-istilah di atas, tulis ulang semantic_query menggunakan sinonim yang lebih kaya agar pencarian vektor lebih akurat (misal: "cab chassis sasis kosong karoseri boks komersial").
    `;

    const selfQuerySchema = {
      type: SchemaType.OBJECT,
      properties: {
        semantic_query: { type: SchemaType.STRING, description: "Kata kunci pencarian teknis otomotif tanpa harga" },
        exact_keywords: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Array kata kunci fitur harga mati seperti panoramic roof, moonroof, sunroof, captain seat"
        },
        exclude_keywords: {
          type: SchemaType.ARRAY,
          items: { type: SchemaType.STRING },
          description: "Array kata kunci kecualian atau jenis komersial"
        },
        budget_min: { type: SchemaType.NUMBER, nullable: true, description: "Batas bawah harga Rupiah atau null" },
        budget_max: { type: SchemaType.NUMBER, nullable: true, description: "Batas atas harga Rupiah atau null" },
        price_sort: {
          type: SchemaType.STRING,
          nullable: true,
          description: "termurah, termahal, keduanya, atau null"
        },
        engine_type: {
          type: SchemaType.STRING,
          nullable: true,
          description: "bensin, hybrid, ev, diesel, atau null"
        },
        seats: { type: SchemaType.NUMBER, nullable: true, description: "Jumlah kursi (5, 7, 16) atau null" },
        is_fuel_efficient: { type: SchemaType.BOOLEAN, description: "true jika mencari mobil irit/hemat BBM" },
        is_listing: { type: SchemaType.BOOLEAN, description: "true jika meminta daftar/tampilkan semua" },
      },
      required: ["semantic_query", "exact_keywords", "exclude_keywords", "is_fuel_efficient", "is_listing"],
    };

    const promptText = `${historyContext}Pertanyaan Kustomer Terbaru: "${message}"`;
    const result = await model.generateContent({
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      systemInstruction: { role: "user", parts: [{ text: systemInstruction }] },
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 500,
        responseMimeType: "application/json",
        responseSchema: selfQuerySchema,
      },
    });

    const rewrittenStr = result.response.text().trim();
    console.log(`[RAG Self-Query] Result:`, rewrittenStr);
    const selfQuery: SelfQuery = JSON.parse(rewrittenStr);

    // Fallback normalization
    selfQuery.semantic_query = selfQuery.semantic_query || message;
    selfQuery.exact_keywords = selfQuery.exact_keywords || [];
    selfQuery.exclude_keywords = selfQuery.exclude_keywords || [];
    selfQuery.budget_min = selfQuery.budget_min || null;
    selfQuery.budget_max = selfQuery.budget_max || null;

    return selfQuery;
  } catch (err) {
    console.error("[RAG Self-Query] Error, falling back to default:", err);
    return defaultFallback;
  }
}

// --- BM25 Lexical Scorer & Reciprocal Rank Fusion (RRF) ---
function calculateBM25Score(
  query: string,
  docText: string,
  avgDocLen: number = 50,
  k1: number = 1.2,
  b: number = 0.75
): number {
  if (!query || !docText) return 0;

  const tokenize = (text: string) =>
    text
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 1);

  const queryTokens = tokenize(query);
  const docTokens = tokenize(docText);
  if (queryTokens.length === 0 || docTokens.length === 0) return 0;

  const docLen = docTokens.length;
  const docFreqMap: Record<string, number> = {};
  for (const t of docTokens) {
    docFreqMap[t] = (docFreqMap[t] || 0) + 1;
  }

  let score = 0;
  for (const token of queryTokens) {
    const tf = docFreqMap[token] || 0;
    if (tf > 0) {
      const tfNorm = (tf * (k1 + 1)) / (tf + k1 * (1 - b + b * (docLen / avgDocLen)));
      score += tfNorm;
    }
  }

  return score;
}

function combineRRF(candidates: any[], queryText: string): any[] {
  if (!candidates || candidates.length === 0) return [];

  // Sort by Vector distance ascending (rank 1 is smallest distance)
  const vectorSorted = [...candidates].sort((a, b) => (parseFloat(a.jarak) || 0) - (parseFloat(b.jarak) || 0));

  // Compute BM25 scores
  const withBM25 = candidates.map((row) => {
    const fullText = `${row.tipe_mobil || ''} ${row.varian || ''} ${typeof row.spesifikasi_detail === 'string' ? row.spesifikasi_detail : JSON.stringify(row.spesifikasi_detail || '')}`;
    const bm25Score = calculateBM25Score(queryText, fullText);
    return { row, bm25Score };
  });

  // Sort by BM25 score descending
  const bm25Sorted = [...withBM25].sort((a, b) => b.bm25Score - a.bm25Score);

  const vectorRankMap = new Map<any, number>();
  vectorSorted.forEach((item, index) => vectorRankMap.set(item, index + 1));

  const bm25RankMap = new Map<any, number>();
  bm25Sorted.forEach((item, index) => bm25RankMap.set(item.row, index + 1));

  const kConstant = 60;
  const scored = candidates.map((row) => {
    const vRank = vectorRankMap.get(row) || candidates.length;
    const bRank = bm25RankMap.get(row) || candidates.length;
    const rrfScore = (1 / (kConstant + vRank)) + (1 / (kConstant + bRank));
    return { row, rrfScore };
  });

  // Sort by RRF score descending
  scored.sort((a, b) => b.rrfScore - a.rrfScore);
  return scored.map((s) => s.row);
}

// --- Dynamic Toyota Feature Synonym Dictionary ---
const FEATURE_SYNONYM_MAP: Record<string, { triggers: string[]; targets: string[] }> = {
  kamera_360: {
    triggers: ["360", "around view", "kamera 360"],
    targets: ["360", "around view", "panoramic view", "pvm", "kamera"],
  },
  sunroof: {
    triggers: ["sunroof"],
    targets: ["sunroof"]
  },
  panoramic: {
    triggers: ["panoramic"],
    targets: ["panoramic"]
  },
  moonroof: {
    triggers: ["moonroof"],
    targets: ["moonroof"]
  },
  captain_seat: {
    triggers: ["captain"],
    targets: ["captain", "kapten"]
  },
  tss: {
    triggers: ["tss", "safety sense"],
    targets: ["tss", "safety sense"]
  },
  wireless_charger: {
    triggers: ["wireless charger", "cas nirkabel"],
    targets: ["wireless charger", "nirkabel", "qi charger"],
  },
};

// --- Helper for Dynamic Exact Keyword Feature Fallback Matching ---
function hasFeatureMatch(hasil: any[], exactKeywords: string[]): boolean {
  if (!exactKeywords || exactKeywords.length === 0) return true;
  if (!hasil || hasil.length === 0) return false;

  return hasil.some((row) => {
    const text = `${row.tipe_mobil || ''} ${row.varian || ''} ${typeof row.spesifikasi_detail === 'string' ? row.spesifikasi_detail : JSON.stringify(row.spesifikasi_detail || '')}`.toLowerCase();

    return exactKeywords.some((kw) => {
      const cleaned = kw.toLowerCase().trim();
      if (!cleaned) return false;

      const matchedGroup = Object.values(FEATURE_SYNONYM_MAP).find((group) =>
        group.triggers.some((trigger) => cleaned.includes(trigger))
      );

      if (matchedGroup) {
        return matchedGroup.targets.some((target) => text.includes(target));
      }

      // 1. Matched as exact phrase in text
      if (text.includes(cleaned)) return true;

      // 2. Matched as multi-word tokens
      const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 1) {
        return words.every((w) => text.includes(w));
      }

      return false;
    });
  });
}

function buildFeatureSqlCondition(exactKeywords: string[]): string {
  if (!exactKeywords || exactKeywords.length === 0) return "";
  const clauses: string[] = [];

  for (const kw of exactKeywords) {
    const cleaned = kw.toLowerCase().trim().replace(/'/g, "''");
    if (!cleaned) continue;

    const matchedGroup = Object.values(FEATURE_SYNONYM_MAP).find((group) =>
      group.triggers.some((trigger) => cleaned.includes(trigger))
    );

    if (matchedGroup) {
      const synonymLikes = matchedGroup.targets
        .map((target) => `LOWER(spesifikasi_detail) LIKE '%${target}%' OR LOWER(varian) LIKE '%${target}%'`)
        .join(" OR ");
      clauses.push(`(${synonymLikes})`);
    } else {
      const words = cleaned.split(/\s+/).filter((w) => w.length > 2);
      if (words.length > 1) {
        const tokenAnds = words.map((w) => `LOWER(spesifikasi_detail) LIKE '%${w}%'`).join(" AND ");
        clauses.push(`((${tokenAnds}) OR LOWER(spesifikasi_detail) LIKE '%${cleaned}%' OR LOWER(varian) LIKE '%${cleaned}%')`);
      } else {
        clauses.push(`(LOWER(spesifikasi_detail) LIKE '%${cleaned}%' OR LOWER(varian) LIKE '%${cleaned}%')`);
      }
    }
  }

  if (clauses.length === 0) return "";
  return ` AND (${clauses.join(" OR ")})`;
}

async function cariKonteksHybrid(
  selfQuery: SelfQuery,
  originalMessage: string,
  chatHistory: { role: string; content: string }[] = []
): Promise<string> {
  // Budget tolerance: jika budget_min === budget_max (misal user bilang "budget 350 juta"),
  // artinya "sampai 350 juta", bukan "tepat 350 juta". Null-kan budget_min.
  let budgetMin = selfQuery.budget_min;
  let budgetMax = selfQuery.budget_max;
  if (budgetMin !== null && budgetMax !== null && budgetMin === budgetMax) {
    console.log(`[Budget Tolerance] budget_min === budget_max (${budgetMin}), treating as "up to ${budgetMax}". Setting budget_min = null.`);
    budgetMin = null;
  }
  const queryIrit = selfQuery.is_fuel_efficient;
  const queryHarga = selfQuery.price_sort;
  const engineType = selfQuery.engine_type;
  const queryListing = selfQuery.is_listing;
  const seaterFilter = selfQuery.seats;
  const expandedQuery = selfQuery.semantic_query;

  let isFallbackFeature = false;

  // Ambil daftar model dari database (dengan cache 1 jam)
  const modelNames = await fetchModelNames();

  // Deteksi apakah user menanyakan model mobil spesifik (dari pesan asli + query perluasan)
  const textForModelDetect = originalMessage + " " + expandedQuery;
  const { included: models, excluded } = parseQueryModels(textForModelDetect, modelNames);
  const isSpecificModel = models.length > 0;

  let modelFilter = "";
  if (isSpecificModel) {
    const conditions = models.map((m) => `LOWER(tipe_mobil) LIKE '%${m}%'`).join(" OR ");
    modelFilter = ` AND (${conditions})`;
  }

  // Build model exclusion clause
  let excludeFilter = "";
  const allExcludes = [...new Set([...excluded, ...(selfQuery.exclude_keywords || [])])];
  if (allExcludes.length > 0) {
    const conditions = allExcludes.map((m) => {
      const kw = m.toLowerCase().trim();
      if (kw === 'truk') {
        return `(LOWER(tipe_mobil) NOT LIKE '%truk%' AND LOWER(spesifikasi_detail) NOT LIKE '% truk %' AND LOWER(spesifikasi_detail) NOT LIKE 'truk %' AND LOWER(spesifikasi_detail) NOT LIKE '% truk')`;
      }
      return `(LOWER(tipe_mobil) NOT LIKE '%${kw}%' AND LOWER(spesifikasi_detail) NOT LIKE '%${kw}%')`;
    }).join(" AND ");
    excludeFilter = ` AND (${conditions})`;
  }

  // Build hybrid/ev filter clause
  let hybridClause = "";
  if (engineType === "bensin" || (selfQuery as any).is_hybrid === false) {
    hybridClause = " AND (LOWER(varian) NOT LIKE '%hybrid%' AND LOWER(varian) NOT LIKE '%hev%' AND LOWER(varian) NOT LIKE '%ev%' AND LOWER(varian) NOT LIKE '%bev%' AND LOWER(tipe_mobil) NOT LIKE '%hybrid%' AND LOWER(tipe_mobil) NOT LIKE '%hev%' AND LOWER(tipe_mobil) NOT LIKE '%ev%' AND LOWER(tipe_mobil) NOT LIKE '%bev%' AND LOWER(spesifikasi_detail) NOT LIKE '%diesel%')";
  } else if (engineType === "hybrid" || (selfQuery as any).is_hybrid === true) {
    hybridClause = " AND (LOWER(varian) LIKE '%hybrid%' OR LOWER(varian) LIKE '%hev%' OR LOWER(tipe_mobil) LIKE '%hybrid%' OR LOWER(tipe_mobil) LIKE '%hev%')";
  } else if (engineType === "ev") {
    hybridClause = " AND (LOWER(varian) LIKE '%bev%' OR LOWER(tipe_mobil) LIKE '%bev%' OR LOWER(spesifikasi_detail) LIKE '%battery electric vehicle%')";
  } else if (engineType === "diesel") {
    hybridClause = " AND (LOWER(spesifikasi_detail) LIKE '%diesel%')";
  }

  // Build seater filter clause
  let seaterClause = "";
  if (seaterFilter === 7) {
    seaterClause = " AND (spesifikasi_detail LIKE '%7 orang%' OR spesifikasi_detail LIKE '%7 penumpang%' OR spesifikasi_detail LIKE '%8 penumpang%' OR spesifikasi_detail LIKE '%7-seater%' OR spesifikasi_detail LIKE '%7 seater%' OR spesifikasi_detail LIKE '%7 seat%' OR spesifikasi_detail LIKE '%7-seat%' OR spesifikasi_detail LIKE '%7 hingga 8 penumpang%' OR spesifikasi_detail LIKE '%7-8 penumpang%' OR spesifikasi_detail LIKE '%7 s/d 8 penumpang%')";
  } else if (seaterFilter === 5) {
    seaterClause = " AND (spesifikasi_detail LIKE '%5 orang%' OR spesifikasi_detail LIKE '%5 penumpang%' OR spesifikasi_detail LIKE '%5-seater%' OR spesifikasi_detail LIKE '%5 seater%' OR spesifikasi_detail LIKE '%5 seat%' OR spesifikasi_detail LIKE '%5-seat%')";
  } else if (seaterFilter === 16) {
    seaterClause = " AND (spesifikasi_detail LIKE '%16 orang%' OR spesifikasi_detail LIKE '%microbus%' OR spesifikasi_detail LIKE '%mikrobus%' OR tipe_mobil LIKE '%Hiace%')";
  }

  // Build budget filter clause
  let budgetClause = "";
  const budgetParams: number[] = [];
  if (budgetMin !== null) {
    budgetClause += " AND harga >= ?";
    budgetParams.push(budgetMin);
  }
  if (budgetMax !== null) {
    budgetClause += " AND harga <= ?";
    budgetParams.push(budgetMax);
  }

  // Catatan: Pencocokan kata kunci fitur (exact_keywords) kini ditangani secara fleksibel oleh BM25 + RRF
  // sehingga tidak lagi membutuhkan filter SQL LIKE yang kaku (mencegah 0-result).
  const additionalFilters = `${modelFilter}${excludeFilter}${hybridClause}${seaterClause}${budgetClause}`;

  // --- FAST PATH: Direct SQL Query HANYA jika user menanyakan harga murni tanpa fitur spesifik ---
  // Jika ada exact_keywords (misal: "mobil sunroof termurah"), WAJIB lewat Dual-Retrieval Hybrid Search agar fitur tidak bypass!
  if (queryHarga && selfQuery.exact_keywords.length === 0) {
    console.log(`[RAG Price Compare] Detected: "${queryHarga}" with filters: "${additionalFilters}" — bypassing vector search`);
    let koneksiHarga: mysql.Connection | undefined;
    try {
      koneksiHarga = await getDbConnection();

      const featureClause = buildFeatureSqlCondition(selfQuery.exact_keywords);
      const effectivePriceFilters = `${additionalFilters}${featureClause}`;

      const runPriceQuery = async (filters: string, bParams: any[]) => {
        let sql = '';
        if (isSpecificModel) {
          if (queryHarga === 'keduanya') {
            sql = `
              (SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM data_mobil_hybrid WHERE 1=1 ${filters} ORDER BY harga ASC LIMIT 1)
              UNION ALL
              (SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM data_mobil_hybrid WHERE 1=1 ${filters} ORDER BY harga DESC LIMIT 1)
            `;
          } else if (queryHarga === 'termurah') {
            sql = `SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM data_mobil_hybrid WHERE 1=1 ${filters} ORDER BY harga ASC LIMIT 5`;
          } else {
            sql = `SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM data_mobil_hybrid WHERE 1=1 ${filters} ORDER BY harga DESC LIMIT 5`;
          }
          const [rows] = await koneksiHarga!.execute(sql, bParams);
          return rows as any[];
        } else {
          if (queryHarga === 'keduanya') {
            sql = `
              SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM (
                SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol,
                       ROW_NUMBER() OVER (PARTITION BY tipe_mobil ORDER BY harga ASC) AS rn
                FROM data_mobil_hybrid
                WHERE 1=1 ${filters}
              ) ranked
              WHERE rn = 1
              ORDER BY harga ASC LIMIT 6
            `;
          } else if (queryHarga === 'termurah') {
            sql = `
              SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM (
                SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol,
                       ROW_NUMBER() OVER (PARTITION BY tipe_mobil ORDER BY harga ASC) AS rn
                FROM data_mobil_hybrid
                WHERE 1=1 ${filters}
              ) ranked
              WHERE rn = 1
              ORDER BY harga ASC LIMIT 5
            `;
          } else {
            sql = `
              SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak FROM (
                SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol,
                       ROW_NUMBER() OVER (PARTITION BY tipe_mobil ORDER BY harga DESC) AS rn
                FROM data_mobil_hybrid
                WHERE 1=1 ${filters}
              ) ranked
              WHERE rn = 1
              ORDER BY harga DESC LIMIT 5
            `;
          }
          const [rows] = await koneksiHarga!.execute(sql, bParams);
          return rows as any[];
        }
      };

      let hasil = await runPriceQuery(effectivePriceFilters, budgetParams);

      const hasRequestedFeature = selfQuery.exact_keywords.length === 0 || hasFeatureMatch(hasil, selfQuery.exact_keywords);

      // Fallback: Jika tidak ada unit ber-fitur tersebut di bawah budget, jalankan query tanpa filter fitur
      if ((hasil.length === 0 || !hasRequestedFeature) && selfQuery.exact_keywords.length > 0) {
        console.log("[RAG Price Compare] 0 results with feature filter, falling back to price query without feature filter.");
        const fallbackHasil = await runPriceQuery(additionalFilters, budgetParams);
        if (fallbackHasil.length > 0) {
          hasil = fallbackHasil;
          if (!hasRequestedFeature) isFallbackFeature = true;
        }
      }

      console.log("[RAG DATABASE RESULTS COUNT]", hasil.length);
      console.log("[RAG DATABASE RESULTS]", hasil.map(h => `${h.tipe_mobil} ${h.varian} — Rp ${Number(h.harga).toLocaleString('id-ID')}`));

      // Build context string
      let konteks = "";
      for (const row of hasil) {
        const hargaRaw = parseFloat(row.harga);
        const hargaFormatted = new Intl.NumberFormat("id-ID").format(hargaRaw);
        konteks += `\n- MOBIL: ${row.tipe_mobil} ${row.varian}\n`;
        konteks += `  HARGA: Rp ${hargaFormatted} (OTR Labuhanbatu)\n`;
        konteks += `  KONSUMSI BBM (DALAM KOTA): ${row.bbm_kota} km/l\n`;
        konteks += `  KONSUMSI BBM (LUAR KOTA/TOL): ${row.bbm_tol} km/l\n`;

        let specText = row.spesifikasi_detail;
        if (typeof row.spesifikasi_detail === 'object' && row.spesifikasi_detail !== null) {
          specText = JSON.stringify(row.spesifikasi_detail);
        }
        konteks += `  DETAIL FITUR: ${specText}\n`;
      }

      if (isFallbackFeature && selfQuery.exact_keywords.length > 0) {
        const budgetText = budgetMax ? `di bawah Rp ${new Intl.NumberFormat("id-ID").format(budgetMax)}` : `di atas Rp ${new Intl.NumberFormat("id-ID").format(budgetMin!)}`;
        konteks += `\n[CATATAN PENTING UNTUK AI SALES EXECUTIVE: Kustomer mencari mobil dengan fitur "${selfQuery.exact_keywords.join(", ")}" untuk budget ${budgetText}. Namun, di database resmi Auto2000 Rantauprapat, TIDAK ADA unit mobil Toyota di rentang harga tersebut yang memiliki fitur "${selfQuery.exact_keywords.join(", ")}". Unit yang disajikan di atas adalah opsi mobil Toyota yang MEMILIKI fitur "${selfQuery.exact_keywords.join(", ")}" dengan rentang harga terdekat. WAJIB JELASKAN HAL INI SECARA JUJUR, RAMAH, DAN SOPAN bahwa untuk mendapatkan fitur tersebut, budget perlu disesuaikan dengan unit di atas.]\n`;
      }

      if (!konteks.trim()) {
        return "[HASIL PENCARIAN DATABASE KOSONG / 0 UNIT DITEMUKAN. Tidak ada unit Toyota di database resmi Auto2000 Rantauprapat yang memenuhi kriteria pencarian ini.]";
      }
      return konteks;
    } catch (error) {
      console.error("[RAG Price Compare] Database error:", error);
      return "";
    } finally {
      if (koneksiHarga) await koneksiHarga.end();
    }
  }

  // --- NORMAL PATH: Vector similarity search ---
  console.log(
    `[DEBUG] Irit: ${queryIrit}, BudgetMin: ${budgetMin}, BudgetMax: ${budgetMax}, Specific Model: ${isSpecificModel}, EngineType: ${engineType}, Listing: ${queryListing}`
  );

  // Get embedding vector from HuggingFace (menggunakan expandedQuery untuk akurasi semantik)
  const vektor = await getHuggingFaceEmbedding(expandedQuery);
  if (!vektor) {
    console.error("Error mendapatkan embedding dari Hugging Face");
    return "";
  }

  const vektorStr = JSON.stringify(vektor);
  let koneksi;

  try {
    koneksi = await getDbConnection();
    let hasil: any[] = [];

    console.log("[RAG SPECIFIC MODELS DETECTED]", models);
    console.log("[RAG WHERE CLAUSES]", { additionalFilters, isSpecificModel });

    // Jika mencari model spesifik ATAU user meminta listing, bebaskan filter rn agar seluruh varian bisa diambil.
    const filterRn = (isSpecificModel || queryListing) ? "" : "WHERE rn = 1";
    const orderClause = queryIrit
      ? "bbm_kota DESC, jarak ASC"
      : "jarak ASC"; // Biarkan vector search bekerja sepenuhnya

    let rnOrder = "";
    let useVectorForRn = false;
    if (queryIrit) {
      rnOrder = "bbm_kota DESC";
    } else if (budgetMax !== null) {
      rnOrder = `ABS(harga - ${budgetMax}) ASC`;
    } else {
      rnOrder = "vec_cosine_distance(embedding, ?)";
      useVectorForRn = true;
    }

    // --- PATH 1: Dense Vector Retrieval ---
    const vectorLimit = (isSpecificModel || queryListing) ? (isSpecificModel ? "LIMIT 30" : "LIMIT 15") : "LIMIT 15";
    const vectorSql = `
      SELECT tipe_mobil, varian, harga, spesifikasi_detail, jarak, bbm_kota, bbm_tol FROM (
        SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol,
               vec_cosine_distance(embedding, ?) AS jarak,
               ROW_NUMBER() OVER (PARTITION BY tipe_mobil ORDER BY ${rnOrder}) AS rn
        FROM data_mobil_hybrid
        WHERE 1=1 ${additionalFilters}
      ) ranked
      ${filterRn}
      ORDER BY ${orderClause}
      ${vectorLimit}
    `;

    const vectorParams: any[] = [vektorStr];
    if (useVectorForRn) {
      vectorParams.push(vektorStr);
    }
    vectorParams.push(...budgetParams);

    // --- PATH 2: Sparse Lexical / Keyword Retrieval ---
    let keywordCandidates: any[] = [];
    const searchTerms = selfQuery.exact_keywords.length > 0 ? selfQuery.exact_keywords : [expandedQuery];
    const featureKeywordClause = buildFeatureSqlCondition(searchTerms);

    if (featureKeywordClause) {
      const keywordSql = `
        SELECT tipe_mobil, varian, harga, spesifikasi_detail, 999 as jarak, bbm_kota, bbm_tol
        FROM data_mobil_hybrid
        WHERE 1=1 ${additionalFilters} ${featureKeywordClause}
        LIMIT 15
      `;
      try {
        const [kwRows] = await koneksi.execute(keywordSql, budgetParams);
        keywordCandidates = kwRows as any[];
        console.log(`[RAG Dual-Retrieval] Path 2 (Lexical Keyword Search) fetched ${keywordCandidates.length} candidate rows.`);
      } catch (kwErr) {
        console.error("[RAG Dual-Retrieval] Path 2 Lexical Search error (continuing with Vector only):", kwErr);
      }
    }

    const [vectorRows] = await koneksi.execute(vectorSql, vectorParams);
    const vectorCandidates = vectorRows as any[];
    console.log(`[RAG Dual-Retrieval] Path 1 (Dense Vector Search) fetched ${vectorCandidates.length} candidate rows.`);

    // --- UNION & DEDUPLICATION (Candidate Pool) ---
    const candidateMap = new Map<string, any>();
    for (const row of vectorCandidates) {
      const key = `${row.tipe_mobil?.toLowerCase()}_${row.varian?.toLowerCase()}`;
      candidateMap.set(key, row);
    }
    for (const row of keywordCandidates) {
      const key = `${row.tipe_mobil?.toLowerCase()}_${row.varian?.toLowerCase()}`;
      if (!candidateMap.has(key)) {
        candidateMap.set(key, row);
      }
    }

    let combinedCandidates = Array.from(candidateMap.values());
    console.log(`[RAG Dual-Retrieval] Combined Candidate Pool: ${combinedCandidates.length} unique items.`);

    // --- HYBRID RE-RANKING via BM25 + Vector RRF ---
    if (combinedCandidates.length > 0) {
      const fullSearchQuery = `${originalMessage} ${expandedQuery} ${(selfQuery.exact_keywords || []).join(" ")}`;
      combinedCandidates = combineRRF(combinedCandidates, fullSearchQuery);
      console.log(`[RAG Hybrid RRF] Re-ranked ${combinedCandidates.length} candidates using BM25 + Vector RRF.`);

      // Jika kustomer meminta pengurutan harga pada pencarian ber-fitur (misal: "mobil kamera 360 termurah")
      if (queryHarga === "termurah") {
        combinedCandidates.sort((a, b) => parseFloat(a.harga) - parseFloat(b.harga));
        console.log(`[RAG Hybrid Sort] Sorted feature candidate pool by price ASC (termurah).`);
      } else if (queryHarga === "termahal") {
        combinedCandidates.sort((a, b) => parseFloat(b.harga) - parseFloat(a.harga));
        console.log(`[RAG Hybrid Sort] Sorted feature candidate pool by price DESC (termahal).`);
      }
    }

    const finalLimit = (isSpecificModel || queryListing) ? 15 : 7;
    hasil = combinedCandidates.slice(0, finalLimit);

    const hasRequestedFeature = selfQuery.exact_keywords.length === 0 || hasFeatureMatch(hasil, selfQuery.exact_keywords);

    // Fallback: jika hasil 0 ATAU mobil yang disaring di bawah budget tidak memiliki fitur spesifik (exact_keywords)
    if ((hasil.length === 0 || !hasRequestedFeature) && (budgetMin !== null || budgetMax !== null)) {
      console.log(`[RAG Fallback] ${hasil.length === 0 ? "0 results" : "Feature requested but not found"} with budget filter. Removing budget constraints and finding closest matches.`);
      const fallbackPrice = budgetMax ?? budgetMin!;
      const featureClause = buildFeatureSqlCondition(selfQuery.exact_keywords);

      const fallbackSql = `SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak 
         FROM data_mobil_hybrid 
         WHERE 1=1 ${modelFilter}${excludeFilter}${hybridClause}${seaterClause}${featureClause}
         ORDER BY ABS(harga - ?) ASC LIMIT 7`;
      const [fallbackRows] = await koneksi.execute(fallbackSql, [fallbackPrice]);
      if ((fallbackRows as any[]).length > 0) {
        hasil = fallbackRows as any[];
        if (!hasRequestedFeature) isFallbackFeature = true;
        console.log(`[RAG Fallback] Found ${hasil.length} feature-matching results after removing budget constraints.`);
      } else if (hasil.length === 0) {
        const fallbackSqlNoFeature = `SELECT tipe_mobil, varian, harga, spesifikasi_detail, bbm_kota, bbm_tol, 0 as jarak 
           FROM data_mobil_hybrid 
           WHERE 1=1 ${modelFilter}${excludeFilter}${hybridClause}${seaterClause}
           ORDER BY ABS(harga - ?) ASC LIMIT 5`;
        const [fallbackRowsNoFeature] = await koneksi.execute(fallbackSqlNoFeature, [fallbackPrice]);
        hasil = fallbackRowsNoFeature as any[];
        console.log(`[RAG Fallback] Found ${hasil.length} closest price results without feature filter.`);
      }
    }

    // Build context string
    let konteks = "";
    for (const row of hasil) {
      const hargaRaw = parseFloat(row.harga);
      const hargaFormatted = new Intl.NumberFormat("id-ID").format(hargaRaw);
      konteks += `\n- MOBIL: ${row.tipe_mobil} ${row.varian}\n`;
      konteks += `  HARGA: Rp ${hargaFormatted} (OTR Labuhanbatu)\n`;
      konteks += `  KONSUMSI BBM (DALAM KOTA): ${row.bbm_kota} km/l\n`;
      konteks += `  KONSUMSI BBM (LUAR KOTA/TOL): ${row.bbm_tol} km/l\n`;

      let specText = row.spesifikasi_detail;
      if (typeof row.spesifikasi_detail === 'object' && row.spesifikasi_detail !== null) {
        specText = JSON.stringify(row.spesifikasi_detail);
      }

      konteks += `  DETAIL FITUR: ${specText}\n`;
      if (row.jarak !== undefined) {
        konteks += `  (Relevansi: ${parseFloat(row.jarak).toFixed(4)})\n`;
      }
    }

    if (isFallbackFeature && selfQuery.exact_keywords.length > 0) {
      const budgetText = budgetMax ? `di bawah Rp ${new Intl.NumberFormat("id-ID").format(budgetMax)}` : `di atas Rp ${new Intl.NumberFormat("id-ID").format(budgetMin!)}`;
      konteks += `\n[CATATAN PENTING UNTUK AI SALES EXECUTIVE: Kustomer mencari mobil dengan fitur "${selfQuery.exact_keywords.join(", ")}" untuk budget ${budgetText}. Namun, di database resmi Auto2000 Rantauprapat, TIDAK ADA unit mobil Toyota di rentang harga tersebut yang memiliki fitur "${selfQuery.exact_keywords.join(", ")}". Unit yang disajikan di atas adalah opsi mobil Toyota yang MEMILIKI fitur "${selfQuery.exact_keywords.join(", ")}" dengan rentang harga terdekat. WAJIB JELASKAN HAL INI SECARA JUJUR, RAMAH, DAN SOPAN bahwa untuk mendapatkan fitur tersebut, budget perlu disesuaikan dengan unit di atas.]\n`;
    }

    console.log("[RAG DATABASE RESULTS COUNT]", hasil.length);
    console.log("[RAG DATABASE RESULTS]", hasil.map(h => `${h.tipe_mobil} ${h.varian}`));
    if (!konteks.trim()) {
      return "[HASIL PENCARIAN DATABASE KOSONG / 0 UNIT DITEMUKAN. Tidak ada unit Toyota di database resmi Auto2000 Rantauprapat yang memenuhi kriteria pencarian ini.]";
    }
    return konteks;
  } catch (error) {
    console.error("Database error:", error);
    return "";
  } finally {
    if (koneksi) {
      await koneksi.end();
    }
  }
}

// --- Generate Gemini Response ---
async function tanyaGemini(
  pertanyaan: string,
  konteksDb: string,
  chatHistory: { role: string; content: string }[]
): Promise<string> {
  const apiKey = process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GOOGLE_API_KEY not configured");

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: "gemini-3.1-flash-lite" });

  const systemPrompt = `
    Anda adalah Sales Executive profesional dan ramah dari Auto2000 Rantauprapat.
    Tugas Anda adalah melayani pertanyaan kustomer mengenai lini mobil terbaru Toyota.

    SUMBER DATA UTAMA:
    <data_database>
    ${konteksDb}
    </data_database>

    PEDOMAN JAWABAN & ATURAN UTAMA:
    1. STRICT GROUND TRUTH (ANTI-HALUSINASI):
       - Jawab HANYA berdasarkan data di <data_database>. Semua harga adalah OTR Labuhanbatu.
       - DILARANG KERAS menebak/membuat-buat harga, varian, atau spesifikasi dari memori Anda jika data tidak ada di <data_database>.
       - Jika unit tidak ditemukan / database kosong, katakan dengan jujur bahwa unit belum tersedia di database resmi kami saat ini, lalu rekomendasikan alternatif model Toyota sekelas yang tersedia.
    2. LOGIKA REKOMENDASI & FITUR SPESIFIK:
       - Jika kustomer mencari fitur spesifik (misal: sunroof, panoramic roof, moonroof, TSS, captain seat, atau mobil irit): TAMPILKAN LANGSUNG varian di <data_database> yang MEMILIKI fitur tersebut beserta harganya sebagai rekomendasi utama. Dilarang menampilkan harga varian terendah yang tidak memiliki fitur tersebut.
       - PERHATIKAN PEMISAHAN SPESIFIKASI ATAP KACA: Sunroof (kaca yang dapat dibuka/tilt), Moonroof (kaca yang dapat digeser), dan Panoramic Roof / Panoramic Glass Roof (atap kaca lebar panoramic) adalah fitur yang BERBEDA secara fungsi dan spesifikasi. Sebutkan tipe atap kaca persis sesuai data di <data_database> dan DILARANG menyebut panoramic/moonroof sebagai sunroof jika tidak tercantum sebagai sunroof di database.
       - Untuk keiritan BBM, gunakan acuan angka km/l di database (semakin tinggi angka km/l = semakin irit).
       - Untuk kustomer yang bertanya umum tentang suatu model (misal: "Berapa harga Avanza?"), sebutkan rentang harga dari varian terendah hingga varian tertinggi di database.
    3. BATASAN LAYANAN & PERHITUNGAN KREDIT (OUT-OF-SCOPE):
       - Hanya melayani konsultasi unit baru & spesifikasi Toyota. Tolak perbandingan dengan merek lain secara sopan.
       - DILARANG KERAS memberikan atau mencoba menghitung estimasi simulasi kredit, angsuran per bulan, cicilan, atau rincian DP. Hal tersebut berada di luar cakupan sistem AI ini.
       - Jika kustomer bertanya tentang simulasi kredit, hitungan DP, atau cicilan bulanan, WAJIB arahkan kustomer secara ramah dan sopan untuk mengakses fitur Simulasi Kredit di halaman Katalog Mobil (/mobil) atau menghubungi Sales Consultant resmi Auto2000 Rantauprapat.
    4. FORMAT & PERSONA:
       - Gunakan bahasa yang sopan dan hangat (sapa dengan 'Bapak/Ibu').
       - Gunakan format Markdown rapi (**teks tebal** untuk nama mobil & harga) dan poin-poin agar mudah dibaca.
  `;

  // Kirim riwayat percakapan terbaru (maks 6 pesan) agar Gemini memahami konteks follow-up.
  // Ini penting agar pertanyaan lanjutan seperti "yang lebih murah dari itu?" bisa dipahami.
  const contents: { role: "user" | "model"; parts: { text: string }[] }[] = [];

  if (chatHistory && chatHistory.length > 0) {
    const recentHistory = chatHistory.slice(-6);
    for (const msg of recentHistory) {
      // Gemini API menggunakan "model" bukan "assistant"
      const geminiRole = msg.role === "assistant" ? "model" : "user";
      contents.push({
        role: geminiRole,
        parts: [{ text: msg.content }],
      });
    }

    // Gemini API mensyaratkan pesan pertama harus role "user".
    // Hapus pesan-pesan "model" di awal jika ada (misal welcome message).
    while (contents.length > 0 && contents[0].role === "model") {
      contents.shift();
    }
  }

  // Pastikan pesan terakhir adalah pesan user saat ini
  // Jika chatHistory sudah mengandung pesan user terakhir, tidak perlu duplikasi
  const lastContent = contents[contents.length - 1];
  if (!lastContent || lastContent.role !== "user" || lastContent.parts[0].text !== pertanyaan) {
    contents.push({
      role: "user",
      parts: [{ text: pertanyaan }],
    });
  }

  const maxRetry = 5;
  for (let attempt = 0; attempt < maxRetry; attempt++) {
    try {
      const result = await model.generateContent({
        contents,
        systemInstruction: { role: "user", parts: [{ text: systemPrompt }] },
        generationConfig: { temperature: 0.2 },
      });

      return result.response.text();
    } catch (error: any) {
      if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED")) {
        const waitTime = Math.min(2 ** attempt * 5, 60) * 1000;
        if (attempt < maxRetry - 1) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
      }
      if (error?.message?.includes("DEADLINE_EXCEEDED")) {
        const waitTime = 2 ** attempt * 1000;
        if (attempt < maxRetry - 1) {
          await new Promise((resolve) => setTimeout(resolve, waitTime));
          continue;
        }
      }
      throw error;
    }
  }

  throw new Error("Max retries exceeded");
}

// --- API Route Handler ---
export async function POST(req: Request) {
  try {
    const { message, chatHistory = [] } = await req.json();

    if (!message || typeof message !== "string") {
      return NextResponse.json(
        { error: "Pesan tidak boleh kosong." },
        { status: 400 }
      );
    }

    // --- STEP 1: Jalankan Self-Query (JSON) ---
    const selfQuery = await rewriteQueryForRAG(message, chatHistory);

    // --- STEP 2: RAG Context Retrieval ---
    const konteks = await cariKonteksHybrid(selfQuery, message, chatHistory);

    // --- STEP 3: Distributed Concurrency Lock (Semaphore) ---
    let usingLocalQueue = true;

    let jawaban = "";
    let redisSuccess = false;

    if (isRedisEnabled && redis) {
      try {
        const concurrencyKey = "toyota:queue:gemini_concurrency";
        const maxConcurrent = 10;
        const pollIntervalMs = 1000;
        const maxWaitTimeMs = 15000; // Tunggu maks 15 detik
        let waitedTime = 0;
        let acquired = false;

        while (waitedTime < maxWaitTimeMs) {
          // Atomic increment untuk melihat berapa request yang sedang running
          const activeCount = await redis.incr(concurrencyKey);

          if (activeCount <= maxConcurrent) {
            acquired = true;
            console.log(`[Redis Lock] Acquired. Active requests: ${activeCount}`);
            break;
          }

          // Jika melebihi limit, langsung decrement kembali dan tunggu
          await redis.decr(concurrencyKey);

          console.log(`[Redis Lock] Gemini busy (active count: ${activeCount}). Waiting ${pollIntervalMs}ms...`);
          await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
          waitedTime += pollIntervalMs;
        }

        if (!acquired) {
          console.warn(`[Redis Lock] Wait timeout. Queue busy.`);
          return NextResponse.json(
            {
              error:
                "⚠️ Mohon maaf, server AI sedang melayani banyak kustomer. Silakan tunggu beberapa detik dan coba lagi.",
            },
            { status: 429 }
          );
        }

        // Jalankan Gemini & pastikan decrement dilakukan di block finally
        try {
          jawaban = await tanyaGemini(message, konteks, chatHistory);
          redisSuccess = true;
        } finally {
          const afterCount = await redis.decr(concurrencyKey);
          console.log(`[Redis Lock] Released. Active requests remaining: ${afterCount}`);
        }
      } catch (redisError) {
        console.error("[Redis Fallback Alert] Upstash Redis mengalami gangguan. Mengalihkan secara otomatis ke Local Semaphore...", redisError);
        redisSuccess = false; // Menandai gagal agar diteruskan ke blok local semaphore di bawah
      }
    }

    if (!redisSuccess) {
      // Fallback ke Local In-Memory Queue (Semaphore)
      const queueStatus = localSemaphore.status;
      if (queueStatus.queued > 0) {
        console.log(`[Local Queue] Request queued. Running: ${queueStatus.running}, Queued: ${queueStatus.queued}`);
      }

      await localSemaphore.acquire();
      try {
        jawaban = await tanyaGemini(message, konteks, chatHistory);
      } finally {
        localSemaphore.release();
      }
    }

    const debugInfo = [];
    if (selfQuery.semantic_query) debugInfo.push(`Semantik: "${selfQuery.semantic_query}"`);
    if (selfQuery.exact_keywords && selfQuery.exact_keywords.length > 0) debugInfo.push(`Wajib: [${selfQuery.exact_keywords.join(', ')}]`);
    if (selfQuery.exclude_keywords && selfQuery.exclude_keywords.length > 0) debugInfo.push(`Kecuali: [${selfQuery.exclude_keywords.join(', ')}]`);
    let budgetStr = "";
    if (selfQuery.budget_min && selfQuery.budget_max) {
      budgetStr = `Rp${selfQuery.budget_min.toLocaleString('id-ID')} - Rp${selfQuery.budget_max.toLocaleString('id-ID')}`;
    } else if (selfQuery.budget_min) {
      budgetStr = `> Rp${selfQuery.budget_min.toLocaleString('id-ID')}`;
    } else if (selfQuery.budget_max) {
      budgetStr = `< Rp${selfQuery.budget_max.toLocaleString('id-ID')}`;
    }

    if (budgetStr) debugInfo.push(`Budget: ${budgetStr}`);
    if (selfQuery.seats) debugInfo.push(`Kursi: ${selfQuery.seats}`);
    if (selfQuery.engine_type !== null) debugInfo.push(`Mesin: ${selfQuery.engine_type}`);
    if (selfQuery.price_sort) debugInfo.push(`Sort: ${selfQuery.price_sort}`);
    if (selfQuery.is_fuel_efficient) debugInfo.push(`Irit: Ya`);

    const rewrittenStr = debugInfo.join(' | ');

    return NextResponse.json({
      response: jawaban,
      context: konteks,
      rewrittenQuery: rewrittenStr || undefined,
    });

  } catch (error: any) {
    console.error("AI Chat API error:", error);

    if (error?.status === 429 || error?.message?.includes("RESOURCE_EXHAUSTED")) {
      return NextResponse.json(
        {
          error:
            "⚠️ Mohon maaf, kuota API sedang penuh. Silakan tunggu 1-2 menit lalu coba lagi.",
        },
        { status: 429 }
      );
    }

    if (error?.message?.includes("DEADLINE_EXCEEDED")) {
      return NextResponse.json(
        {
          error:
            "⏳ Mohon maaf, server AI sedang sibuk. Silakan coba kirim pertanyaan sekali lagi.",
        },
        { status: 504 }
      );
    }

    return NextResponse.json(
      {
        error:
          "⚠️ Terjadi kesalahan pada sistem. Silakan coba lagi nanti.",
      },
      { status: 500 }
    );
  }
}
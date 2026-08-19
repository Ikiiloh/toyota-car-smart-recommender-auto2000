"use client";

import React, { useState, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Button } from "@/components/ui/button";
import Hero from "./Hero";
import ChatSidebar, { HistoryItem } from "./ChatSidebar";
import CarCompareDrawer, { CarDetail } from "./CarCompareDrawer";
import MessageActions from "./MessageActions";
import ThemeToggler from "@/components/ThemeToggle";
import { useMobilStore } from "@/lib/store/useCarStore";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  SendHorizonal,
  Bot,
  User,
  RotateCcw,
  Scale,
  Eye,
  Check,
  X,
  Compass,
  Menu,
  Sparkles,
  Car,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  rewrittenQuery?: string;
  context?: string;
}

const WELCOME_MESSAGE = `Selamat datang di **Layanan Konsultasi Digital Auto2000 Rantauprapat**! 🚗✨

Saya adalah asisten virtual konsultan resmi Auto2000. Saya siap membantu Anda menemukan unit Toyota terbaik dengan harga OTR Labuhanbatu secara cepat dan akurat.

Silakan ketik kriteria mobil idaman Anda di bawah ini untuk memulai.`;

// --- Custom Flat SVGs representing car shapes ---
function CarSilhouette({ name }: { name: string }) {
  const nameLower = name.toLowerCase();

  // Commercial / Pickup
  if (nameLower.includes("hilux")) {
    return (
      <svg className="w-36 h-16 text-muted-foreground/40 group-hover:text-red-500/30 transition-colors" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 38 L10 26 L22 20 L58 18 L60 30 L92 30 L94 38 Z" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 20 L35 12 L52 12 L58 18" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <line x1="60" y1="30" x2="60" y2="24" stroke="currentColor" strokeWidth="1.5" />
        <circle cx="26" cy="38" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
        <circle cx="74" cy="38" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
      </svg>
    );
  }

  // SUV
  if (nameLower.includes("fortuner") || nameLower.includes("land cruiser") || nameLower.includes("rush") || nameLower.includes("raize") || nameLower.includes("cross")) {
    return (
      <svg className="w-36 h-16 text-muted-foreground/40 group-hover:text-red-500/30 transition-colors" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 38 L10 26 L22 20 L55 18 L80 22 L90 28 L94 38 Z" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M22 20 L35 12 L68 12 L80 22" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="28" cy="38" r="7" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
        <circle cx="74" cy="38" r="7" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
      </svg>
    );
  }

  // MPV
  if (nameLower.includes("innova") || nameLower.includes("zenix") || nameLower.includes("avanza") || nameLower.includes("veloz") || nameLower.includes("calya") || nameLower.includes("alphard") || nameLower.includes("vellfire")) {
    return (
      <svg className="w-36 h-16 text-muted-foreground/40 group-hover:text-red-500/30 transition-colors" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 38 L10 28 L28 17 L72 15 L88 24 L92 38 Z" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M28 17 L42 13 L70 13 L82 20" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="28" cy="38" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
        <circle cx="72" cy="38" r="6.5" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
      </svg>
    );
  }

  // Sedan / Compact Hatchback
  return (
    <svg className="w-36 h-16 text-muted-foreground/40 group-hover:text-red-500/30 transition-colors" viewBox="0 0 100 50" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M10 38 L15 30 L30 26 L55 22 L75 27 L88 32 L92 38 Z" fill="currentColor" fillOpacity="0.05" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M30 26 L42 16 L65 16 L75 27" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="28" cy="38" r="6" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
      <circle cx="72" cy="38" r="6" stroke="currentColor" strokeWidth="1.5" fill="currentColor" fillOpacity="0.1" />
    </svg>
  );
}

// --- Flat Minimalist Radar Scanning Animation ---
function RadarLoader() {
  return (
    <div className="flex flex-col items-center justify-center p-4 sm:p-6 w-full bg-card border border-border rounded-xl shadow-xs relative overflow-hidden">
      <div className="flex items-center gap-3">
        <div className="relative w-7 h-7 rounded-full border-2 border-red-500/40 flex items-center justify-center">
          <div className="w-2 h-2 rounded-full bg-red-600 animate-ping" />
        </div>
        <div className="space-y-1">
          <h4 className="text-xs font-bold text-foreground flex items-center gap-1.5">
            <Compass className="w-3.5 h-3.5 text-red-600 animate-spin" />
            Mencari Unit Toyota Sesuai Kriteria...
          </h4>
          <p className="text-[10px] text-muted-foreground font-mono">
            Mohon Tunggu Sebentar...
          </p>
        </div>
      </div>
    </div>
  );
}

// Helper function to match RAG recommended car names to Google Sheet data images
const matchCarImage = (recommendedName: string, storeCars: any[]): string | null => {
  if (!storeCars || storeCars.length === 0) return null;

  const cleanRec = recommendedName.toLowerCase()
    .replace(/^(toyota\s+)?(all\s+new\s+|new\s+)?(kijang\s+)?/i, "")
    .trim();

  for (const car of storeCars) {
    if (!car.nama || !car.gambar) continue;

    const cleanStoreName = car.nama.toLowerCase()
      .replace(/-/g, " ")
      .replace(/^toyota\s+/i, "")
      .trim();

    if (cleanRec.includes(cleanStoreName) || cleanStoreName.includes(cleanRec)) {
      return car.gambar;
    }
  }

  const recWords = cleanRec.split(/\s+/).filter((w: string) => w.length > 2);
  for (const car of storeCars) {
    if (!car.nama || !car.gambar) continue;

    const cleanStoreName = car.nama.toLowerCase().replace(/-/g, " ").replace(/^toyota\s+/i, "").trim();
    const storeWords = cleanStoreName.split(/\s+/).filter((w: string) => w.length > 2);

    const hasWordMatch = storeWords.some((word: string) => recWords.includes(word));
    if (hasWordMatch) {
      return car.gambar;
    }
  }

  return null;
};

export default function ChatInterface() {
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: WELCOME_MESSAGE },
  ]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [contextData, setContextData] = useState<Record<number, string>>({});

  // LocalStorage User Search History State
  const [userHistoryList, setUserHistoryList] = useState<HistoryItem[]>([]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("toyota_ai_user_history");
      if (saved) {
        setUserHistoryList(JSON.parse(saved));
      }
    } catch (e) {
      console.error("Failed to parse history from localStorage", e);
    }
  }, []);

  const addQueryToHistory = (queryText: string) => {
    const cleanQuery = queryText.trim();
    if (!cleanQuery) return;

    const newItem: HistoryItem = {
      id: Date.now().toString(),
      query: cleanQuery,
      timestamp: new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" }) + ", " + new Date().toLocaleDateString("id-ID", { day: "numeric", month: "short" }),
    };

    setUserHistoryList((prev) => {
      const filtered = prev.filter((item) => item.query.toLowerCase() !== cleanQuery.toLowerCase());
      const updated = [newItem, ...filtered].slice(0, 20);
      try {
        localStorage.setItem("toyota_ai_user_history", JSON.stringify(updated));
      } catch (e) { }
      return updated;
    });
  };

  const handleClearHistory = () => {
    setUserHistoryList([]);
    try {
      localStorage.removeItem("toyota_ai_user_history");
    } catch (e) { }
  };

  const handleDeleteHistoryItem = (id: string) => {
    setUserHistoryList((prev) => {
      const updated = prev.filter((item) => item.id !== id);
      try {
        localStorage.setItem("toyota_ai_user_history", JSON.stringify(updated));
      } catch (e) { }
      return updated;
    });
  };

  // UI state for drawers & modals
  const [activeCarDetail, setActiveCarDetail] = useState<CarDetail | null>(null);
  const [compareList, setCompareList] = useState<CarDetail[]>([]);
  const [isCompareOpen, setIsCompareOpen] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [expandedCarCards, setExpandedCarCards] = useState<Record<number, boolean>>({});

  const toggleCarCards = (idx: number) => {
    setExpandedCarCards((prev) => ({
      ...prev,
      [idx]: !prev[idx],
    }));
  };

  const { cars: storeCars, fetchCars } = useMobilStore();

  useEffect(() => {
    if (storeCars.length === 0) {
      fetchCars();
    }
  }, [storeCars.length, fetchCars]);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messageRefs = useRef<(HTMLDivElement | null)[]>([]);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isZeroState = messages.length <= 1;

  useEffect(() => {
    if (messages.length > 1) {
      const lastIdx = messages.length - 1;
      const lastMsg = messages[lastIdx];
      // Jika pesan terakhir adalah balasan assistant, scroll ke bagian ATAS pesan assistant tersebut
      if (lastMsg.role === "assistant") {
        setTimeout(() => {
          messageRefs.current[lastIdx]?.scrollIntoView({ behavior: "smooth", block: "start" });
        }, 100);
      } else {
        // Jika user baru mengirim pesan, scroll ke bawah agar terlihat loading/pesan user
        messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
      }
    }
  }, [messages]);

  useEffect(() => {
    if (isLoading) {
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [isLoading]);

  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
  }, [isZeroState]);

  const isCarMentionedInText = (carName: string, text: string): boolean => {
    if (!text || !carName) return false;
    const lowerText = text.toLowerCase();
    
    // Bersihkan nama mobil dari prefix umum
    const cleanName = carName.toLowerCase()
      .replace(/^(toyota\s+)?(all\s+new\s+|new\s+)?(kijang\s+)?/i, "")
      .trim();

    // Daftar model multi-kata yang perlu dicocokkan secara spesifik
    const multiWordModels = [
      "corolla cross",
      "corolla altis",
      "innova zenix",
      "innova reborn",
      "yaris cross",
      "gr yaris",
      "yaris gr sport",
      "land cruiser",
      "hilux rangga",
      "hilux d-cab",
      "hilux double cabin",
      "hilux single cabin",
      "urban cruiser",
      "gr supra",
      "gr 86"
    ];

    for (const model of multiWordModels) {
      if (cleanName.includes(model)) {
        if (lowerText.includes(model)) return true;
        const subName = model.split(" ")[1];
        if (subName && lowerText.includes(subName)) return true;
      }
    }

    // Penanganan khusus Yaris biasa vs Yaris Cross
    if (cleanName.startsWith("yaris") && !cleanName.includes("cross")) {
      const hasRegularYaris = /\byaris\b(?!\s+cross)/i.test(lowerText) || lowerText.includes("gr yaris") || lowerText.includes("yaris gr");
      if (hasRegularYaris) return true;
      return false;
    }

    // Penanganan khusus Corolla biasa vs Corolla Cross / Altis
    if (cleanName.startsWith("corolla") && !cleanName.includes("cross") && !cleanName.includes("altis")) {
      if (lowerText.includes("corolla")) return true;
    }

    // Pencocokan kata utama model (misal: "avanza", "veloz", "calya", "rush", "fortuner", "voxy", "alphard", "vellfire", "bz4x", "raize", "agya", "hiace", "camry")
    const words = cleanName.split(/\s+/).filter(w => w.length > 2);
    if (words.length > 0) {
      const primaryWord = words[0];
      if (!["type", "tipe", "cvt", "hev", "bev", "dsl", "sport"].includes(primaryWord)) {
        if (lowerText.includes(primaryWord)) {
          return true;
        }
      }
    }

    return false;
  };

  const parseContextCars = (contextStr: string, assistantContent?: string): CarDetail[] => {
    if (!contextStr) return [];
    const cars: CarDetail[] = [];
    const blocks = contextStr.split(/(?=\n-\s*MOBIL:|-\s*MOBIL:)/g);

    for (const block of blocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/(?:-\s*)?MOBIL:\s*([^\n]+)/);
      const priceMatch = block.match(/HARGA:\s*([^\n]+)/);
      const bbmKotaMatch = block.match(/KONSUMSI BBM \(DALAM KOTA\):\s*([^\n]+)/);
      const bbmTolMatch = block.match(/KONSUMSI BBM \(LUAR KOTA\/TOL\):\s*([^\n]+)/);
      const detailMatch = block.match(/DETAIL FITUR:\s*([^\n]+)/);

      if (nameMatch) {
        const name = nameMatch[1].trim();

        if (assistantContent && !isCarMentionedInText(name, assistantContent)) {
          continue;
        }
        const price = priceMatch ? priceMatch[1].trim() : "Hubungi Dealer";
        const bbmKota = bbmKotaMatch ? bbmKotaMatch[1].trim() : "";
        const bbmTol = bbmTolMatch ? bbmTolMatch[1].trim() : "";

        let rawSpecs: any = {};
        if (detailMatch) {
          try {
            rawSpecs = JSON.parse(detailMatch[1].trim());
          } catch {
            rawSpecs = {};
          }
        }

        let fuelType = "Bensin";
        const nameLower = name.toLowerCase();
        if (nameLower.includes("hybrid") || nameLower.includes("hev") || JSON.stringify(rawSpecs).toLowerCase().includes("hybrid") || JSON.stringify(rawSpecs).toLowerCase().includes("hev")) {
          fuelType = "Hybrid";
        } else if (nameLower.includes("ev") || nameLower.includes("bev") || nameLower.includes("electric") || JSON.stringify(rawSpecs).toLowerCase().includes("battery ev")) {
          fuelType = "Listrik";
        } else if (nameLower.includes("dsl") || nameLower.includes("diesel") || JSON.stringify(rawSpecs).toLowerCase().includes("diesel")) {
          fuelType = "Diesel";
        }

        let transmission = "e-CVT";
        const specEngineLower = (rawSpecs.engine_transmission || "").toLowerCase();
        const allSpecStr = JSON.stringify(rawSpecs).toLowerCase();

        if (fuelType === "Listrik") {
          transmission = "-";
        } else if (
          fuelType === "Hybrid" ||
          nameLower.includes("hev") ||
          nameLower.includes("hybrid") ||
          allSpecStr.includes("hybrid") ||
          allSpecStr.includes("hev")
        ) {
          // Semua mobil HEV / Hybrid otomatis transmisi e-CVT
          transmission = "e-CVT";
        } else if (
          nameLower.includes("e-cvt") ||
          nameLower.includes("ecvt") ||
          specEngineLower.includes("e-cvt") ||
          specEngineLower.includes("ecvt") ||
          allSpecStr.includes("e-cvt") ||
          allSpecStr.includes("ecvt")
        ) {
          transmission = "e-CVT";
        } else if (
          nameLower.includes("cvt") ||
          specEngineLower.includes("cvt") ||
          allSpecStr.includes("cvt")
        ) {
          transmission = "CVT";
        } else if (
          /\ba\/t\b|\bat\b|automatic|otomatis/.test(nameLower) ||
          /\ba\/t\b|\bat\b|automatic|otomatis/.test(specEngineLower) ||
          /\ba\/t\b|\bat\b|automatic|otomatis/.test(allSpecStr)
        ) {
          transmission = "A/T";
        } else if (
          /\bm\/t\b|\bmt\b|manual/.test(nameLower) ||
          /\bm\/t\b|\bmt\b|manual/.test(specEngineLower) ||
          /\bm\/t\b|\bmt\b|manual/.test(allSpecStr)
        ) {
          transmission = "M/T";
        } else {
          // Yang tidak dieksplisitkan transmisi apa -> otomatis e-CVT
          transmission = "e-CVT";
        }

        let capacity = "5 Penumpang";
        const specStr = JSON.stringify(rawSpecs).toLowerCase();
        if (nameLower.includes("avanza") || nameLower.includes("veloz") || nameLower.includes("zenix") || nameLower.includes("innova") || nameLower.includes("calya") || nameLower.includes("alphard") || nameLower.includes("rush") || nameLower.includes("fortuner") || nameLower.includes("land cruiser")) {
          capacity = "7 Penumpang";
        } else if (specStr.includes("7 penumpang") || specStr.includes("7 orang") || specStr.includes("7-seater") || specStr.includes("7 seat")) {
          capacity = "7 Penumpang";
        } else if (specStr.includes("5 penumpang") || specStr.includes("5 orang") || specStr.includes("5-seater") || specStr.includes("5 seat")) {
          capacity = "5 Penumpang";
        } else if (nameLower.includes("rangga") && (nameLower.includes("cab-chs") || nameLower.includes("pu"))) {
          capacity = "2 Penumpang";
        }

        let hasTSS = false;
        if (nameLower.includes("tss") || nameLower.includes("safety sense") || specStr.includes("tss") || specStr.includes("safety sense") || specStr.includes("collision") || specStr.includes("departure")) {
          hasTSS = true;
        }

        const matchedImg = matchCarImage(name, storeCars);

        cars.push({
          name,
          price,
          bbmKota,
          bbmTol,
          transmission,
          fuelType,
          capacity,
          hasTSS,
          rawSpecs,
          image: matchedImg,
        });
      }
    }
    return cars;
  };

  const sendMessage = async (overrideText?: string) => {
    const text = overrideText || input;
    if (!text.trim() || isLoading) return;

    addQueryToHistory(text);

    const newMessages: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMessages);
    setInput("");
    setIsLoading(true);

    const chatHistory = newMessages.slice(1).map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    try {
      const response = await fetch("/api/ai-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          chatHistory: chatHistory.slice(-10),
        }),
      });

      const data = await response.json();

      if (data.error) {
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: data.error },
        ]);
      } else {
        const messageIndex = newMessages.length;
        if (data.context) {
          setContextData((prev) => ({
            ...prev,
            [messageIndex]: data.context,
          }));
        }
        setMessages((prev) => [
          ...prev,
          {
            role: "assistant",
            content: data.response,
            rewrittenQuery: data.rewrittenQuery || undefined,
            context: data.context || undefined,
          },
        ]);
      }
    } catch {
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content:
            "⚠️ Terjadi kesalahan jaringan. Pastikan koneksi internet Anda stabil dan coba lagi.",
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleTextareaInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const textarea = e.target;
    textarea.style.height = "auto";
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + "px";
  };

  const resetChat = () => {
    setMessages([{ role: "assistant", content: WELCOME_MESSAGE }]);
    setContextData({});
    setCompareList([]);
    setInput("");
  };

  const toggleCompare = (car: CarDetail) => {
    setCompareList((prev) => {
      const exists = prev.find((item) => item.name === car.name);
      if (exists) {
        return prev.filter((item) => item.name !== car.name);
      } else {
        if (prev.length >= 3) {
          alert("Anda dapat membandingkan maksimal 3 mobil sekaligus.");
          return prev;
        }
        return [...prev, car];
      }
    });
  };

  const removeCompareCar = (name: string) => {
    setCompareList((prev) => prev.filter((car) => car.name !== name));
  };

  return (
    <div className="flex flex-col h-[calc(100dvh-68px)] sm:h-[calc(100dvh-64px)] w-full px-2 sm:px-4 md:px-6 max-w-5xl mx-auto relative overflow-hidden bg-background text-foreground">
      {/* Slide-over Mobile & Desktop Sidebar with LocalStorage User History */}
      <ChatSidebar
        isOpen={isSidebarOpen}
        onClose={() => setIsSidebarOpen(false)}
        historyList={userHistoryList}
        onSelectHistory={(queryText) => sendMessage(queryText)}
        onClearHistory={handleClearHistory}
        onDeleteHistoryItem={handleDeleteHistoryItem}
        onResetChat={resetChat}
      />

      {/* Side-by-side Spec Comparison Drawer */}
      <CarCompareDrawer
        isOpen={isCompareOpen}
        onClose={() => setIsCompareOpen(false)}
        cars={compareList}
        onRemoveCar={removeCompareCar}
        onConsultCar={(carName) => sendMessage(`Berikan informasi lengkap dan spesifikasi untuk Toyota ${carName}`)}
      />

      {/* Header App Bar */}
      <header className="flex-shrink-0 flex items-center justify-between py-2 sm:py-3 border-b border-border mb-1 sm:mb-2">
        <div className="flex items-center gap-2">
          {/* Menu Toggle */}
          <Button
            onClick={() => setIsSidebarOpen(true)}
            variant="outline"
            size="icon"
            className="h-9 w-9 rounded-lg border-border text-foreground hover:bg-muted active:scale-95 relative"
            title="Buka Menu Konsultasi & Riwayat"
          >
            <Menu className="w-4 h-4" />
            {userHistoryList.length > 0 && (
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-red-600 rounded-full border-2 border-background" />
            )}
          </Button>

          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white shadow-xs">
              <Bot className="w-4.5 h-4.5" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h1 className="font-bold text-xs sm:text-sm tracking-tight text-foreground">
                  Toyota Smart Recommender
                </h1>
              </div>
              <p className="text-[10px] text-muted-foreground flex items-center gap-1 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                Auto2000 Rantauprapat
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          {!isZeroState && (
            <Button
              onClick={resetChat}
              variant="outline"
              size="sm"
              className="rounded-lg border-border text-[11px] font-semibold gap-1.5 h-8 px-2 sm:px-2.5 hover:bg-muted text-muted-foreground hover:text-foreground active:scale-95 transition-all"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span className="hidden xs:inline sm:inline">Sesi Baru</span>
            </Button>
          )}
          <ThemeToggler />
        </div>
      </header>

      {/* Scrollable Main Chat Area */}
      <div className="flex-1 overflow-y-auto min-h-0 py-2 sm:py-3 space-y-4 scrollbar-thin pr-1">
        {isZeroState ? (
          <div className="flex flex-col items-center justify-center min-h-[50vh] max-w-2xl mx-auto my-auto w-full">
            <Hero onSelectPrompt={(prompt) => sendMessage(prompt)} />
          </div>
        ) : (
          <>
            {messages.map((msg, idx) => {
              const cars = msg.role === "assistant" ? parseContextCars(msg.context || contextData[idx] || "", msg.content) : [];
              const isExpanded = expandedCarCards[idx] !== undefined ? expandedCarCards[idx] : true;

              return (
                <div
                  key={idx}
                  ref={(el) => {
                    messageRefs.current[idx] = el;
                  }}
                  className={`flex gap-2.5 sm:gap-3 ${msg.role === "user" ? "justify-end" : "justify-start"} animate-fade-in`}
                >
                  {msg.role === "assistant" && (
                    <div className="flex-shrink-0 w-7.5 h-7.5 rounded-lg bg-red-600 flex items-center justify-center text-white mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}

                  <div
                    className={`max-w-[92%] sm:max-w-[85%] md:max-w-[80%] flex flex-col space-y-2 ${msg.role === "user" ? "items-end" : "items-start"
                      }`}
                  >
                    {/* Message Box */}
                    <div
                      className={`rounded-xl px-3.5 py-3 border text-xs sm:text-sm leading-relaxed ${msg.role === "user"
                        ? "bg-red-600 border-red-700 text-white rounded-tr-none font-medium"
                        : "bg-card border-border rounded-tl-none text-foreground"
                        }`}
                    >
                      {msg.role === "assistant" ? (
                        <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5 marker:text-red-500">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {msg.content}
                          </ReactMarkdown>

                          {/* Assistant Message Actions Toolbar */}
                          <MessageActions
                            content={msg.content}
                            onRegenerate={idx === messages.length - 1 ? () => sendMessage(messages[idx - 1]?.content || "") : undefined}
                          />
                        </div>
                      ) : (
                        <p>{msg.content}</p>
                      )}
                    </div>

                    {/* Collapsible Bento Recommendation Grid for Cars (Option 3 with 2-column grid) */}
                    {msg.role === "assistant" && cars.length > 0 && (
                      <div className="w-full space-y-2 pt-1">
                        <button
                          onClick={() => toggleCarCards(idx)}
                          className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl bg-card hover:bg-muted border border-border text-xs font-semibold text-foreground hover:text-red-600 transition-all active:scale-95 shadow-2xs group"
                        >
                          <div className="w-5 h-5 rounded-md bg-red-500/10 flex items-center justify-center text-red-600 group-hover:bg-red-600 group-hover:text-white transition-colors">
                            <Car className="w-3.5 h-3.5" />
                          </div>
                          <span>
                            {isExpanded
                              ? `Sembunyikan Visual Unit (${cars.length})`
                              : `Lihat Kartu Unit Terkait (${cars.length} Mobil)`}
                          </span>
                          {isExpanded ? (
                            <ChevronUp className="w-3.5 h-3.5 text-muted-foreground ml-0.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5 text-muted-foreground ml-0.5" />
                          )}
                        </button>

                        {isExpanded && (
                          <div className="grid grid-cols-2 gap-1.5 sm:gap-3 pt-1 animate-fade-in w-full">
                            {cars.map((car, carIdx) => {
                              const isComparing = compareList.some((item) => item.name === car.name);

                              return (
                                <div
                                  key={carIdx}
                                  className="group flex flex-col bg-card border border-border rounded-lg sm:rounded-xl overflow-hidden hover:border-red-500/60 transition-all shadow-xs"
                                >
                                  {/* Header / Car Image View */}
                                  <div className="relative h-20 sm:h-36 bg-muted/30 flex items-center justify-center overflow-hidden border-b border-border/50">
                                    {car.image ? (
                                      <img
                                        src={car.image}
                                        alt={car.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                                      />
                                    ) : (
                                      <CarSilhouette name={car.name} />
                                    )}

                                    {/* Spec Pills */}
                                    <div className="absolute top-1 right-1 sm:top-2 sm:right-2 flex flex-wrap gap-0.5 sm:gap-1 items-end justify-end">
                                      {car.hasTSS && (
                                        <span className="px-1 py-0.2 sm:px-1.5 sm:py-0.5 rounded bg-teal-500/10 border border-teal-500/20 text-teal-600 dark:text-teal-400 text-[7px] sm:text-[8px] font-bold uppercase">
                                          TSS
                                        </span>
                                      )}
                                      {car.fuelType === "Hybrid" && (
                                        <span className="px-1 py-0.2 sm:px-1.5 sm:py-0.5 rounded bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-[7px] sm:text-[8px] font-bold uppercase">
                                          HEV
                                        </span>
                                      )}
                                    </div>
                                  </div>

                                  {/* Car Details & Action Buttons */}
                                  <div className="p-2 sm:p-3 flex-1 flex flex-col space-y-1.5">
                                    <div>
                                      <h4 className="font-bold text-[11px] sm:text-sm text-foreground line-clamp-1 group-hover:text-red-600 transition-colors leading-tight">
                                        {car.name}
                                      </h4>
                                      <p className="text-[10px] sm:text-xs font-bold text-red-600 mt-0.5 truncate">
                                        {car.price}
                                      </p>
                                    </div>

                                    <div className="grid grid-cols-2 gap-0.5 text-[9px] sm:text-[10px] text-muted-foreground border-t border-b border-border/40 py-1 my-auto leading-tight">
                                      <div className="truncate">BBM: <span className="font-medium text-foreground">{car.bbmKota ? `${car.bbmKota} km/l` : "Bensin"}</span></div>
                                      <div className="truncate">Trans: <span className="font-medium text-foreground">{car.transmission}</span></div>
                                      <div className="col-span-2 truncate">Kapasitas: <span className="font-medium text-foreground">{car.capacity}</span></div>
                                    </div>

                                    <div className="flex gap-1 pt-0.5">
                                      <Button
                                        onClick={() => setActiveCarDetail(car)}
                                        variant="outline"
                                        size="sm"
                                        className="flex-1 h-7 sm:h-8 text-[10px] sm:text-xs font-semibold rounded-md sm:rounded-lg hover:bg-muted border-border gap-0.5 px-1 active:scale-95"
                                      >
                                        <Eye className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                        Detail
                                      </Button>
                                      <Button
                                        onClick={() => toggleCompare(car)}
                                        variant={isComparing ? "secondary" : "default"}
                                        size="sm"
                                        className={`flex-1 h-7 sm:h-8 text-[10px] sm:text-xs font-semibold rounded-md sm:rounded-lg gap-0.5 px-1 active:scale-95 ${isComparing
                                          ? "bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20"
                                          : "bg-red-600 hover:bg-red-700 text-white"
                                          }`}
                                      >
                                        {isComparing ? (
                                          <>
                                            <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                            Dipilih
                                          </>
                                        ) : (
                                          <>
                                            <Scale className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                                            Banding
                                          </>
                                        )}
                                      </Button>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {msg.role === "user" && (
                    <div className="flex-shrink-0 w-7.5 h-7.5 rounded-lg bg-muted border border-border flex items-center justify-center text-foreground mt-1">
                      <User className="w-4 h-4" />
                    </div>
                  )}
                </div>
              );
            })}

            {isLoading && (
              <div className="flex gap-2.5 justify-start w-full">
                <div className="flex-shrink-0 w-7.5 h-7.5 rounded-lg bg-red-600 flex items-center justify-center text-white mt-1">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="w-full max-w-[85%]">
                  <RadarLoader />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Floating Compare Action Trigger Bar */}
      {compareList.length > 0 && (
        <div className="fixed bottom-20 sm:bottom-16 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-sm bg-card border border-border shadow-lg rounded-xl p-2.5 flex items-center justify-between gap-2 backdrop-blur-md animate-fade-in">
          <div className="flex items-center gap-2 overflow-hidden">
            <span className="text-xs font-bold text-foreground flex-shrink-0">
              Bandingkan ({compareList.length}/3)
            </span>
            <div className="flex gap-1 overflow-x-auto scrollbar-none">
              {compareList.map((car, cIdx) => (
                <span key={cIdx} className="text-[9px] font-semibold bg-red-500/10 text-red-600 px-1.5 py-0.5 rounded truncate max-w-[70px]">
                  {car.name.replace(/Toyota|New|All/g, "").trim()}
                </span>
              ))}
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setCompareList([])}
              className="p-1 rounded hover:bg-muted text-muted-foreground"
            >
              <X className="w-4 h-4" />
            </button>
            <Button
              onClick={() => setIsCompareOpen(true)}
              size="sm"
              className="h-7 px-3 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-lg"
            >
              Buka Matriks
            </Button>
          </div>
        </div>
      )}

      {/* Sticky Bottom Floating Entry Query Input Capsule */}
      <div className="flex-shrink-0 sticky bottom-0 bg-background border-t border-border pt-1.5 pb-2.5 sm:pb-3 z-30 space-y-1.5">
        {/* Quick Keyword Chips */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none max-w-4xl mx-auto py-0.5 px-0.5">
          <span className="text-[10px] font-bold text-muted-foreground whitespace-nowrap flex items-center gap-1">
            <Sparkles className="w-3 h-3 text-red-600" />
            Pencarian Cepat:
          </span>
          {[
            { label: "Hybrid Paling Irit", prompt: "Mobil Toyota apa yang paling irit bahan bakar untuk penggunaan dalam kota?" },
            { label: "7-Seater Keluarga", prompt: "Rekomendasikan mobil keluarga 7 penumpang yang nyaman dan lega" },
            { label: "Budget 400 Juta", prompt: "Saya punya budget 400 jutaan, cari SUV kompak yang modern dan cocok untuk anak muda" },
            { label: "Fortuner TSS", prompt: "Apa saja fitur keselamatan Toyota Safety Sense pada Fortuner tipe VRZ TSS?" },
            { label: "Mobil Off-Road", prompt: "Saya butuh mobil untuk off-road dan medan berat, ada rekomendasi?" },
            { label: "Hilux Usaha", prompt: "Info harga OTR Hilux Rangga Pick Up untuk operasional usaha di Rantauprapat" },
          ].map((chip, chipIdx) => (
            <button
              key={chipIdx}
              onClick={() => sendMessage(chip.prompt)}
              disabled={isLoading}
              className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-muted/60 hover:bg-red-500/10 border border-border hover:border-red-500/40 text-[10px] text-muted-foreground hover:text-red-600 font-medium whitespace-nowrap transition-all active:scale-95 flex-shrink-0"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-red-600 flex-shrink-0" />
              <span>{chip.label}</span>
            </button>
          ))}
        </div>

        <div className="flex items-end gap-2 max-w-4xl mx-auto">
          <div className="flex-1 relative bg-card border border-border rounded-xl p-1.5 focus-within:border-red-500 transition-colors shadow-xs">
            <textarea
              ref={inputRef}
              value={input}
              onChange={handleTextareaInput}
              onKeyDown={handleKeyDown}
              placeholder="Ketik kriteria atau pertanyaan Anda (misal: 'Mobil hybrid keluarga budget 400 jt')..."
              rows={1}
              className="w-full resize-none bg-transparent border-0 px-2 py-1.5 text-xs sm:text-sm focus:outline-none placeholder:text-muted-foreground/50 text-foreground min-h-[38px] max-h-[100px] scrollbar-none"
              disabled={isLoading}
            />
          </div>
          <Button
            onClick={() => sendMessage()}
            disabled={!input.trim() || isLoading}
            className="h-10 w-10 sm:h-11 sm:w-11 rounded-xl bg-red-600 hover:bg-red-700 text-white flex-shrink-0 active:scale-95 transition-all"
            size="icon"
          >
            <SendHorizonal className="w-4 h-4 sm:w-5 sm:h-5" />
          </Button>
        </div>
      </div>

      {/* Detail Specs Dialog Modal */}
      <Dialog open={activeCarDetail !== null} onOpenChange={(open) => !open && setActiveCarDetail(null)}>
        <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto rounded-xl p-4 sm:p-6 bg-card border border-border">
          {activeCarDetail && (
            <>
              <DialogHeader className="border-b border-border pb-3">
                <div className="flex gap-1.5 items-center mb-1">
                  {activeCarDetail.hasTSS && (
                    <span className="text-[9px] font-bold bg-teal-500/10 text-teal-600 px-2 py-0.5 rounded uppercase">
                      TSS
                    </span>
                  )}
                  <span className="text-[9px] font-bold bg-red-500/10 text-red-600 px-2 py-0.5 rounded uppercase">
                    {activeCarDetail.fuelType}
                  </span>
                  <span className="text-[9px] font-bold bg-muted text-muted-foreground px-2 py-0.5 rounded uppercase">
                    {activeCarDetail.transmission}
                  </span>
                </div>
                <DialogTitle className="text-base font-bold text-foreground">
                  {activeCarDetail.name}
                </DialogTitle>
                <DialogDescription className="text-xs font-bold text-red-600 mt-0.5">
                  Estimasi Harga: {activeCarDetail.price}
                </DialogDescription>
              </DialogHeader>

              <div className="py-3 space-y-3 text-xs">
                {activeCarDetail.image ? (
                  <img src={activeCarDetail.image} alt={activeCarDetail.name} className="w-full h-36 object-cover rounded-lg border border-border" />
                ) : (
                  <div className="h-28 bg-muted/30 rounded-lg border border-border flex items-center justify-center">
                    <CarSilhouette name={activeCarDetail.name} />
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2 bg-muted/30 p-2.5 rounded-lg border border-border/50 text-[11px]">
                  <div>Konsumsi BBM Kota: <span className="font-semibold block text-foreground">{activeCarDetail.bbmKota ? `${activeCarDetail.bbmKota} km/l` : "-"}</span></div>
                  <div>Konsumsi BBM Tol: <span className="font-semibold block text-foreground">{activeCarDetail.bbmTol ? `${activeCarDetail.bbmTol} km/l` : "-"}</span></div>
                  <div className="col-span-2">Kapasitas: <span className="font-semibold text-foreground">{activeCarDetail.capacity}</span></div>
                </div>

                {activeCarDetail.rawSpecs.engine_transmission && (
                  <div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Mesin & Transmisi</span>
                    <p className="p-2 bg-muted/20 border border-border/40 rounded-lg text-muted-foreground mt-1">
                      {activeCarDetail.rawSpecs.engine_transmission}
                    </p>
                  </div>
                )}

                {activeCarDetail.rawSpecs.safety && (
                  <div>
                    <span className="text-[10px] font-bold text-muted-foreground uppercase">Fitur Keselamatan</span>
                    <p className="p-2 bg-muted/20 border border-border/40 rounded-lg text-muted-foreground mt-1">
                      {activeCarDetail.rawSpecs.safety}
                    </p>
                  </div>
                )}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

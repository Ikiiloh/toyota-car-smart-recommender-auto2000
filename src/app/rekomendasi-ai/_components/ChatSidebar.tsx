"use client";

import React from "react";
import {
  Sparkles,
  RotateCcw,
  History,
  Trash2,
  MessageSquare,
  Database,
  X,
  Bot
} from "lucide-react";
import { Button } from "@/components/ui/button";

export interface HistoryItem {
  id: string;
  query: string;
  timestamp: string;
}

interface ChatSidebarProps {
  isOpen: boolean;
  onClose: () => void;
  historyList: HistoryItem[];
  onSelectHistory: (queryText: string) => void;
  onClearHistory: () => void;
  onDeleteHistoryItem: (id: string) => void;
  onResetChat: () => void;
}

export default function ChatSidebar({
  isOpen,
  onClose,
  historyList,
  onSelectHistory,
  onClearHistory,
  onDeleteHistoryItem,
  onResetChat,
}: ChatSidebarProps) {
  if (!isOpen) return null;

  return (
    <>
      {/* Mobile Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Slide-over Drawer Container */}
      <aside className="fixed top-0 left-0 bottom-0 z-50 w-[290px] sm:w-[320px] bg-card border-r border-border shadow-2xl flex flex-col p-4 animate-in slide-in-from-left duration-300">
        {/* Drawer Header */}
        <div className="flex items-center justify-between pb-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-red-600 flex items-center justify-center text-white">
              <Bot className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-foreground">Menu Konsultasi</h3>
              <p className="text-[10px] text-muted-foreground font-mono">Auto2000 AI v2.5</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Action Button: Reset/New Session */}
        <div className="py-3">
          <Button
            onClick={() => {
              onResetChat();
              onClose();
            }}
            variant="default"
            className="w-full h-10 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-xs gap-2 shadow-sm active:scale-95"
          >
            <RotateCcw className="w-4 h-4" />
            Mulai Sesi Baru
          </Button>
        </div>

        {/* Scrollable User Chat History Section */}
        <div className="flex-1 overflow-y-auto space-y-4 pr-1 scrollbar-thin py-2">
          <div>
            <div className="flex items-center justify-between mb-2 px-1">
              <h4 className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-red-500" />
                Riwayat Pencarian Anda
              </h4>
              {historyList.length > 0 && (
                <button
                  onClick={onClearHistory}
                  className="text-[10px] text-muted-foreground hover:text-red-500 flex items-center gap-1 transition-colors font-medium"
                  title="Hapus Semua Riwayat"
                >
                  <Trash2 className="w-3 h-3" />
                  Hapus
                </button>
              )}
            </div>

            {historyList.length === 0 ? (
              <div className="p-4 text-center border border-dashed border-border/60 rounded-xl bg-muted/20 text-muted-foreground space-y-1 my-2">
                <MessageSquare className="w-5 h-5 mx-auto text-muted-foreground/40" />
                <p className="text-xs font-semibold text-foreground">Belum ada riwayat</p>
                <p className="text-[10px]">Pertanyaan yang Anda ajukan akan otomatis tersimpan di sini.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                {historyList.map((item) => (
                  <div
                    key={item.id}
                    className="group relative flex items-center justify-between p-2.5 rounded-xl border border-border/60 bg-muted/20 hover:bg-muted hover:border-red-500/40 transition-all text-left"
                  >
                    <button
                      onClick={() => {
                        onSelectHistory(item.query);
                        onClose();
                      }}
                      className="flex-1 min-w-0 pr-2 active:scale-[0.98] text-left"
                    >
                      <div className="font-medium text-xs text-foreground group-hover:text-red-600 transition-colors truncate">
                        {item.query}
                      </div>
                      <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
                        {item.timestamp}
                      </div>
                    </button>

                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteHistoryItem(item.id);
                      }}
                      className="p-1 rounded hover:bg-red-500/10 text-muted-foreground hover:text-red-500 transition-colors opacity-80 sm:opacity-0 group-hover:opacity-100 flex-shrink-0"
                      title="Hapus kueri ini"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* System Tech Metadata Footer */}
        <div className="pt-3 border-t border-border mt-auto space-y-2 text-[10px] font-mono text-muted-foreground">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Database className="w-3 h-3 text-red-500" />
              Dataset OTR:
            </span>
            <span className="text-foreground font-semibold">Labuhanbatu Mei 2026</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1">
              <Sparkles className="w-3 h-3 text-yellow-500" />
              Engine:
            </span>
            <span className="text-foreground font-semibold">Gemini 3.1</span>
          </div>
        </div>
      </aside>
    </>
  );
}

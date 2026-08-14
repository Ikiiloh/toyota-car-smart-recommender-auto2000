"use client";

import React, { useState } from "react";
import { Copy, Check, RefreshCw, ThumbsUp } from "lucide-react";

interface MessageActionsProps {
  content: string;
  onRegenerate?: () => void;
}

export default function MessageActions({
  content,
  onRegenerate,
}: MessageActionsProps) {
  const [copied, setCopied] = useState(false);
  const [liked, setLiked] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1 mt-2 text-xs text-muted-foreground/80 select-none pt-1">
      {/* Copy Button */}
      <button
        onClick={handleCopy}
        className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors font-medium text-[11px] active:scale-95 min-h-[32px] sm:min-h-[28px]"
        title="Salin jawaban"
      >
        {copied ? (
          <>
            <Check className="w-3.5 h-3.5 text-emerald-500" />
            <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Tersalin</span>
          </>
        ) : (
          <>
            <Copy className="w-3.5 h-3.5" />
            <span>Salin</span>
          </>
        )}
      </button>

      {/* Like / Helpful button */}
      <button
        onClick={() => setLiked(!liked)}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded-md transition-colors text-[11px] min-h-[32px] sm:min-h-[28px] ${
          liked ? "bg-red-500/10 text-red-600 font-medium" : "hover:bg-muted text-muted-foreground hover:text-foreground"
        }`}
        title="Membantu"
      >
        <ThumbsUp className={`w-3.5 h-3.5 ${liked ? "fill-red-500 text-red-500" : ""}`} />
      </button>

      {/* Regenerate Response */}
      {onRegenerate && (
        <button
          onClick={onRegenerate}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-md hover:bg-muted text-muted-foreground hover:text-foreground transition-colors text-[11px] min-h-[32px] sm:min-h-[28px]"
          title="Ulangi pencarian"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Ulangi</span>
        </button>
      )}
    </div>
  );
}

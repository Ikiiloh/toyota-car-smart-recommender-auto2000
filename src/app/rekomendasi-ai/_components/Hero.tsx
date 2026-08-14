"use client";

import React from "react";
import { Zap, Shield, Fuel, Car } from "lucide-react";

interface HeroProps {
  onSelectPrompt?: (promptText: string) => void;
}

const SMALL_SUGGESTION_CARDS = [
  {
    title: "Mobil Hybrid Keluarga",
    subtitle: "Innova Zenix & Yaris Cross HEV",
    icon: Zap,
    prompt: "Rekomendasikan mobil Toyota Hybrid paling irit BBM untuk keluarga di Labuhanbatu",
  },
  {
    title: "SUV Tangguh & TSS",
    subtitle: "Fortuner, Rush & Corolla Cross",
    icon: Shield,
    prompt: "Apa saja varian SUV Toyota dengan fitur Toyota Safety Sense (TSS) dan estimasi harganya?",
  },
  {
    title: "City Car Lincah",
    subtitle: "Agya & Raize CVT Irit BBM",
    icon: Fuel,
    prompt: "Rekomendasi mobil city car kompak paling irit BBM di bawah Rp 300 Juta",
  },
  {
    title: "Hilux Pick Up Usaha",
    subtitle: "Hilux Rangga & Single Cab",
    icon: Car,
    prompt: "Info harga OTR Hilux Rangga Pick Up untuk operasional usaha di Rantauprapat",
  },
];

function Hero({ onSelectPrompt }: HeroProps) {
  return (
    <div className="flex flex-col items-center text-center px-3 sm:px-6 max-w-3xl mx-auto pt-2 sm:pt-4 pb-2 w-full">
      {/* Main Title */}
      <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight text-foreground">
        Konsultasi Mobil Toyota <br className="hidden sm:inline" />
        <span className="text-red-600 dark:text-red-500">
          Cerdas & Presisi
        </span>
      </h1>

      {/* Small Recommendation Cards under Title */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 mt-4 sm:mt-6 w-full max-w-xl">
        {SMALL_SUGGESTION_CARDS.map((card, idx) => (
          <button
            key={idx}
            onClick={() => onSelectPrompt && onSelectPrompt(card.prompt)}
            className="flex items-start gap-2.5 p-2.5 sm:p-3 bg-card hover:bg-muted border border-border/80 hover:border-red-500/50 rounded-xl transition-all text-left active:scale-[0.98] group shadow-xs"
          >
            <card.icon className="w-4 h-4 text-red-600 flex-shrink-0 mt-0.5 group-hover:scale-110 transition-transform" />
            <div className="flex-1 min-w-0">
              <div className="font-bold text-xs text-foreground group-hover:text-red-600 transition-colors truncate">
                {card.title}
              </div>
              <div className="text-[10px] text-muted-foreground truncate mt-0.5">
                {card.subtitle}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

export default Hero;

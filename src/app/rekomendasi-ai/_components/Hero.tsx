"use client";

import React from "react";

interface HeroProps {
  onSelectPrompt?: (promptText: string) => void;
}

function Hero({ onSelectPrompt }: HeroProps) {
  return (
    <div className="flex flex-col items-center text-center px-3 sm:px-6 max-w-3xl mx-auto pt-4 sm:pt-8 pb-4 w-full">
      {/* Main Title */}
      <h1 className="text-2xl sm:text-4xl md:text-5xl font-black tracking-tight leading-tight text-foreground">
        Konsultasi Mobil Toyota <br className="hidden sm:inline" />
        <span className="text-red-600 dark:text-red-500">
          Cerdas & Presisi
        </span>
      </h1>

      <p className="text-xs sm:text-sm text-muted-foreground mt-3 max-w-md leading-relaxed">
        Tanyakan rekomendasi unit, perbandingan spesifikasi teknis, konsumsi BBM, hingga harga OTR Labuhanbatu.
      </p>
    </div>
  );
}

export default Hero;

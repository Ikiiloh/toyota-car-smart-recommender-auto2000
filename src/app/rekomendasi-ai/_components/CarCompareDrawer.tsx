"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { X, Scale, Zap, Gauge, Users, Shield, Check, Minus, MessageSquare } from "lucide-react";

export interface CarDetail {
  name: string;
  price: string;
  bbmKota: string;
  bbmTol: string;
  transmission: string;
  fuelType: string;
  capacity: string;
  hasTSS: boolean;
  rawSpecs: any;
  image?: string | null;
}

interface CarCompareDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cars: CarDetail[];
  onRemoveCar: (name: string) => void;
  onConsultCar?: (carName: string) => void;
}

export default function CarCompareDrawer({
  isOpen,
  onClose,
  cars,
  onRemoveCar,
  onConsultCar,
}: CarCompareDrawerProps) {
  const [activeTab, setActiveTab] = useState<"table" | "cards">("table");

  if (cars.length === 0) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl w-[95vw] sm:w-[90vw] max-h-[92vh] sm:max-h-[85vh] flex flex-col p-4 sm:p-6 bg-card text-card-foreground border border-border rounded-2xl shadow-xl overflow-hidden">
        {/* Header */}
        <DialogHeader className="flex-shrink-0 flex flex-row items-center justify-between pb-3 border-b border-border">
          <div className="space-y-0.5">
            <DialogTitle className="text-base sm:text-lg font-bold tracking-tight flex items-center gap-2 text-foreground">
              <Scale className="w-4 h-4 sm:w-5 sm:h-5 text-red-600 flex-shrink-0" />
              <span>Matriks Perbandingan Mobil</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/10 text-red-600 font-mono font-bold">
                {cars.length}/3
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground hidden sm:block">
              Bandingkan estimasi harga OTR Labuhanbatu, efisiensi BBM, transmisi, dan fitur keselamatan TSS.
            </DialogDescription>
          </div>

          {/* View Mode Toggle for Mobile */}
          <div className="flex items-center gap-1 bg-muted p-1 rounded-lg sm:hidden">
            <button
              onClick={() => setActiveTab("table")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                activeTab === "table" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Matriks
            </button>
            <button
              onClick={() => setActiveTab("cards")}
              className={`px-2.5 py-1 rounded text-[11px] font-semibold transition-colors ${
                activeTab === "cards" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              Kartu
            </button>
          </div>
        </DialogHeader>

        {/* Content Body */}
        <div className="flex-1 overflow-y-auto pt-3 pb-2 scrollbar-thin">
          {/* View Option 1: Flat Matrix Table (Desktop & Scrollable Mobile) */}
          <div className={`${activeTab === "table" ? "block" : "hidden sm:block"} overflow-x-auto border border-border rounded-xl`}>
            <table className="w-full text-left text-xs border-collapse min-w-[500px]">
              <thead>
                <tr className="bg-muted/60 border-b border-border">
                  <th className="p-3 font-semibold text-muted-foreground w-1/4">Spesifikasi</th>
                  {cars.map((car, idx) => (
                    <th key={idx} className="p-3 font-bold text-foreground w-1/4 border-l border-border relative">
                      <div className="flex items-start justify-between gap-1">
                        <span className="line-clamp-2 text-xs">{car.name}</span>
                        <button
                          onClick={() => onRemoveCar(car.name)}
                          className="p-1 rounded-md hover:bg-muted text-muted-foreground hover:text-red-500 transition-colors flex-shrink-0"
                          title="Hapus dari perbandingan"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </th>
                  ))}
                  {/* Fill remaining headers if less than 3 */}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <th key={`empty-hdr-${i}`} className="p-3 font-normal text-muted-foreground/40 border-l border-border border-dashed text-center">
                      <span className="text-[11px] italic">+ Tambah Unit</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {/* Image row */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Foto Unit</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border text-center">
                      {car.image ? (
                        <img
                          src={car.image}
                          alt={car.name}
                          className="w-24 h-16 sm:w-32 sm:h-20 object-cover rounded-lg mx-auto border border-border/60"
                        />
                      ) : (
                        <div className="w-24 h-16 sm:w-32 sm:h-20 rounded-lg bg-muted/40 border border-border/60 flex items-center justify-center mx-auto text-muted-foreground text-[10px]">
                          Pratinjau Mobil
                        </div>
                      )}
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-img-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Price OTR */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Harga OTR Labuhanbatu</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border font-bold text-red-600 text-xs sm:text-sm">
                      {car.price}
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-prc-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Transmission & Fuel */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Tipe Mesin / Penggerak</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold border border-border/50">
                          {car.transmission}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-semibold border border-border/50">
                          {car.fuelType}
                        </span>
                      </div>
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-trn-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Fuel Consumption */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Konsumsi BBM</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border text-[11px]">
                      {car.bbmKota ? (
                        <div>
                          <div>Dalam Kota: <span className="font-semibold">{car.bbmKota} km/l</span></div>
                          {car.bbmTol && <div className="text-muted-foreground text-[10px]">Tol: {car.bbmTol} km/l</div>}
                        </div>
                      ) : (
                        <span className="text-muted-foreground italic">Standar Pabrik</span>
                      )}
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-bbm-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Capacity */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Kapasitas Penumpang</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border font-medium">
                      {car.capacity}
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-cap-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Toyota Safety Sense */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Fitur TSS (Safety)</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border">
                      {car.hasTSS ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-[10px]">
                          <Check className="w-3 h-3 text-teal-500" />
                          Terpasang TSS
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-muted-foreground/60 text-[11px]">
                          <Minus className="w-3 h-3" />
                          Standar Safety
                        </span>
                      )}
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-tss-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>

                {/* Actions */}
                <tr>
                  <td className="p-3 font-medium text-muted-foreground bg-muted/20">Konsultasi AI</td>
                  {cars.map((car, idx) => (
                    <td key={idx} className="p-3 border-l border-border">
                      <Button
                        onClick={() => {
                          onClose();
                          if (onConsultCar) onConsultCar(car.name);
                        }}
                        size="sm"
                        variant="outline"
                        className="w-full h-8 text-[11px] font-semibold gap-1 rounded-lg border-red-500/40 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 active:scale-95"
                      >
                        <MessageSquare className="w-3 h-3" />
                        Tanyakan
                      </Button>
                    </td>
                  ))}
                  {Array.from({ length: 3 - cars.length }).map((_, i) => (
                    <td key={`empty-act-${i}`} className="p-3 border-l border-border border-dashed bg-muted/5" />
                  ))}
                </tr>
              </tbody>
            </table>
          </div>

          {/* View Option 2: Mobile Stacked Cards */}
          <div className={`${activeTab === "cards" ? "block" : "hidden"} space-y-3 sm:hidden`}>
            {cars.map((car, idx) => (
              <div key={idx} className="bg-card border border-border rounded-xl p-3.5 space-y-2.5">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-sm text-foreground">{car.name}</h4>
                  <button
                    onClick={() => onRemoveCar(car.name)}
                    className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-red-500"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
                {car.image && (
                  <img src={car.image} alt={car.name} className="w-full h-28 object-cover rounded-lg border border-border" />
                )}
                <div className="flex items-center justify-between text-xs border-b border-border pb-2">
                  <span className="text-muted-foreground">Harga OTR:</span>
                  <span className="font-bold text-red-600">{car.price}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 text-[11px] text-muted-foreground">
                  <div>Transmisi: <span className="font-medium text-foreground">{car.transmission}</span></div>
                  <div>Kapasitas: <span className="font-medium text-foreground">{car.capacity}</span></div>
                  <div>BBM Kota: <span className="font-medium text-foreground">{car.bbmKota || "-"}</span></div>
                  <div>Fitur TSS: <span className="font-medium text-foreground">{car.hasTSS ? "Ya" : "Tidak"}</span></div>
                </div>
                <Button
                  onClick={() => {
                    onClose();
                    if (onConsultCar) onConsultCar(car.name);
                  }}
                  size="sm"
                  className="w-full h-8 text-xs font-semibold bg-red-600 hover:bg-red-700 text-white rounded-lg gap-1"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Tanyakan Spesifikasi Unit
                </Button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

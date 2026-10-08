"use client";

import { Suspense } from "react";
import { AgendaView } from "@/components/agenda/agenda-view";

// `useSearchParams` (vista, fecha, asesor y cita viven en la URL) exige
// un límite de Suspense, igual que la bandeja con `?c=`.
export default function AgendaPage() {
  return (
    <Suspense fallback={null}>
      <AgendaView />
    </Suspense>
  );
}

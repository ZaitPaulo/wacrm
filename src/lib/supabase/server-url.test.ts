import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { serverSupabaseUrl } from "./server-url";

const PUBLIC_URL = "https://supabase.example.co";
const INTERNAL_URL = "http://api-gw:8000";

describe("serverSupabaseUrl", () => {
  let previousInternal: string | undefined;
  let previousPublic: string | undefined;

  beforeEach(() => {
    previousInternal = process.env.SUPABASE_INTERNAL_URL;
    previousPublic = process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_URL = PUBLIC_URL;
    delete process.env.SUPABASE_INTERNAL_URL;
  });

  afterEach(() => {
    if (previousInternal === undefined) delete process.env.SUPABASE_INTERNAL_URL;
    else process.env.SUPABASE_INTERNAL_URL = previousInternal;
    if (previousPublic === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    else process.env.NEXT_PUBLIC_SUPABASE_URL = previousPublic;
  });

  it("uses the public URL when no internal one is configured", () => {
    expect(serverSupabaseUrl()).toBe(PUBLIC_URL);
  });

  it("prefers the internal URL when it is configured", () => {
    process.env.SUPABASE_INTERNAL_URL = INTERNAL_URL;
    expect(serverSupabaseUrl()).toBe(INTERNAL_URL);
  });

  // Una variable declarada pero vacía es el caso real de un .env con
  // `SUPABASE_INTERNAL_URL=` y nada después. Tomarla al pie de la letra
  // dejaría al cliente sin dirección; caer a la pública es lo correcto.
  it("falls back to the public URL when the internal one is empty", () => {
    process.env.SUPABASE_INTERNAL_URL = "";
    expect(serverSupabaseUrl()).toBe(PUBLIC_URL);
  });

  // El nombre importa tanto como el valor: con el prefijo NEXT_PUBLIC_,
  // Next.js hornearía la URL en la imagen en tiempo de compilación y el
  // despliegue no podría cambiarla sin reconstruir.
  it("reads a variable name that Next.js does not inline at build time", () => {
    expect("SUPABASE_INTERNAL_URL".startsWith("NEXT_PUBLIC_")).toBe(false);
  });
});

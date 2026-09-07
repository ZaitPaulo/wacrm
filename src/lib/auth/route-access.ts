// ============================================================
// Qué pantallas del dashboard alcanza cada rol.
//
// Una sola lista alimenta las tres superficies que tienen que
// coincidir: el filtro del sidebar, el guard del shell y el
// destino al que se rebota a quien no llega. Si cada una tuviera
// su propia copia, ocultar una entrada sin bloquear su ruta (o al
// revés) sería un diff de un archivo — justo el bug que este
// módulo evita.
//
// Ojo: esto es UI, no seguridad. El límite real sigue siendo la
// RLS de Postgres (`is_account_member`) y los `requireRole` de las
// rutas de API; acá sólo se decide qué se ofrece y a dónde se
// manda a quien no corresponde. Un agente que se salte estos
// gates igual recibe cero filas de las tablas admin-only.
// ============================================================

import { hasMinRole, type AccountRole } from "./roles";

/**
 * Secciones reservadas a admin+ (y por herencia, owner).
 *
 * El criterio: son pantallas de gestión del negocio — la foto
 * comercial del patio, el catálogo, lo que sale publicado y los
 * automatismos que hablan por la cuenta. El trabajo diario del
 * agente (bandeja, contactos, embudos, documentos, avisos) queda
 * fuera de la lista a propósito.
 */
export const ADMIN_ONLY_ROUTES = [
  "/dashboard",
  "/inventory",
  "/instagram",
  "/broadcasts",
  "/automations",
  "/flows",
  "/agents",
] as const;

/**
 * Primera pantalla de cada rol: la que abre el logo del sidebar y
 * a la que se rebota desde una ruta prohibida.
 *
 * Admin y owner siguen aterrizando en el panel. El agente arranca
 * en la bandeja, que es su pantalla operativa — y además tiene que
 * ser una ruta que él sí pueda ver, porque el redirect post-login
 * de `proxy.ts` manda a todo el mundo a `/dashboard` y es el guard
 * del shell el que lo reencamina.
 */
export const ROLE_HOME: Record<AccountRole, string> = {
  owner: "/dashboard",
  admin: "/dashboard",
  agent: "/inbox",
  viewer: "/inbox",
};

/**
 * Home del rol, tolerante a que todavía no se conozca (el perfil
 * se resuelve async). Sin rol devolvemos la home del agente: es la
 * opción segura — si el usuario resulta ser admin, el sidebar le
 * ofrece el panel apenas carga el perfil.
 */
export function homeForRole(role: AccountRole | null | undefined): string {
  return role ? ROLE_HOME[role] : ROLE_HOME.agent;
}

/**
 * True si la ruta pertenece a una sección admin-only. Compara el
 * prefijo por segmento (`/inventory` y `/inventory/x`, pero no
 * `/inventoryzzz`) para que las subrutas queden cubiertas sin
 * atrapar rutas ajenas que empiecen igual.
 */
export function isAdminOnlyPath(pathname: string): boolean {
  return ADMIN_ONLY_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
}

/**
 * ¿Este rol puede abrir esta ruta?
 *
 * Falla cerrado: sin rol resuelto la respuesta es `false` para
 * cualquier ruta admin-only, así nunca se alcanza a pintar una
 * pantalla restringida mientras el perfil está cargando.
 */
export function canAccessPath(
  pathname: string,
  role: AccountRole | null | undefined,
): boolean {
  if (!isAdminOnlyPath(pathname)) return true;
  return !!role && hasMinRole(role, "admin");
}

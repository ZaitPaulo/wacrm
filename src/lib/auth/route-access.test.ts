import { describe, expect, it } from "vitest";

import { ACCOUNT_ROLES, type AccountRole } from "./roles";
import {
  ADMIN_ONLY_ROUTES,
  ROLE_HOME,
  canAccessPath,
  homeForRole,
  isAdminOnlyPath,
} from "./route-access";

// Rutas operativas: el trabajo diario del agente. Ninguna debería
// aparecer nunca en ADMIN_ONLY_ROUTES.
const OPERATIONAL_ROUTES = [
  "/inbox",
  "/notifications",
  "/contacts",
  "/documents",
  "/pipelines",
  "/settings",
];

describe("isAdminOnlyPath", () => {
  it("reconoce cada ruta reservada", () => {
    for (const route of ADMIN_ONLY_ROUTES) {
      expect(isAdminOnlyPath(route)).toBe(true);
    }
  });

  it("cubre las subrutas", () => {
    expect(isAdminOnlyPath("/automations/123/edit")).toBe(true);
    expect(isAdminOnlyPath("/flows/abc/runs")).toBe(true);
    expect(isAdminOnlyPath("/broadcasts/new")).toBe(true);
  });

  it("no atrapa rutas que solo comparten prefijo", () => {
    // El chequeo es por segmento: sin él, `/inventoryzzz` o un futuro
    // `/agents-help` quedarían bloqueados por accidente.
    expect(isAdminOnlyPath("/inventoryzzz")).toBe(false);
    expect(isAdminOnlyPath("/agents-help")).toBe(false);
  });

  it("deja pasar las rutas operativas", () => {
    for (const route of OPERATIONAL_ROUTES) {
      expect(isAdminOnlyPath(route)).toBe(false);
    }
  });
});

describe("canAccessPath", () => {
  it("da acceso a owner y admin en todas las rutas reservadas", () => {
    for (const route of ADMIN_ONLY_ROUTES) {
      expect(canAccessPath(route, "owner")).toBe(true);
      expect(canAccessPath(route, "admin")).toBe(true);
    }
  });

  it("bloquea a agente y viewer en las rutas reservadas", () => {
    for (const route of ADMIN_ONLY_ROUTES) {
      expect(canAccessPath(route, "agent")).toBe(false);
      expect(canAccessPath(route, "viewer")).toBe(false);
    }
  });

  it("deja las rutas operativas abiertas a todos los roles", () => {
    for (const role of ACCOUNT_ROLES) {
      for (const route of OPERATIONAL_ROUTES) {
        expect(canAccessPath(route, role)).toBe(true);
      }
    }
  });

  it("falla cerrado mientras no se conoce el rol", () => {
    // Es el estado durante `profileLoading`. Si respondiera `true`, el
    // panel alcanzaría a pintarse un frame antes del rebote.
    expect(canAccessPath("/dashboard", null)).toBe(false);
    expect(canAccessPath("/dashboard", undefined)).toBe(false);
    // Pero sin rol tampoco se bloquea lo que no está reservado.
    expect(canAccessPath("/inbox", null)).toBe(true);
  });
});

describe("homeForRole", () => {
  it("manda a cada rol a una ruta que efectivamente puede abrir", () => {
    // La invariante que importa: si la home de un rol cayera dentro de
    // ADMIN_ONLY_ROUTES sin que ese rol llegue, el guard del shell
    // rebotaría en bucle.
    for (const role of ACCOUNT_ROLES) {
      expect(canAccessPath(homeForRole(role), role)).toBe(true);
    }
  });

  it("deja a admin y owner en el panel, y al agente en la bandeja", () => {
    expect(homeForRole("owner")).toBe("/dashboard");
    expect(homeForRole("admin")).toBe("/dashboard");
    expect(homeForRole("agent")).toBe("/inbox");
    expect(homeForRole("viewer")).toBe("/inbox");
  });

  it("sin rol resuelto usa la home del agente", () => {
    expect(homeForRole(null)).toBe(ROLE_HOME.agent);
    expect(homeForRole(undefined)).toBe(ROLE_HOME.agent);
  });

  it("tiene una entrada por cada rol del enum", () => {
    // Un rol nuevo en `ACCOUNT_ROLES` sin entrada acá daría `undefined`
    // como destino del redirect.
    for (const role of ACCOUNT_ROLES) {
      expect(typeof ROLE_HOME[role as AccountRole]).toBe("string");
    }
  });
});

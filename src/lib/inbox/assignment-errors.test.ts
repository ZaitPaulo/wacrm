import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { assignmentErrorKey } from "./assignment-errors";

const MESSAGES = JSON.parse(
  readFileSync(join(process.cwd(), "messages", "es.json"), "utf8"),
);

const THREAD = readFileSync(
  join(process.cwd(), "src", "components", "inbox", "message-thread.tsx"),
  "utf8",
);

// El desplegable "Asignar a" llevaba desde septiembre fallando para todo
// `agent`, con un "Failed to update assignment" que no decía nada. Estos
// son los casos que un asesor puede provocar sin querer.
describe("assignmentErrorKey", () => {
  it("400: el destinatario ya no es miembro de la cuenta", () => {
    expect(assignmentErrorKey(400, { unassigning: false })).toBe("assignNotMember");
  });

  it("403 al reasignar: el hilo no es suyo", () => {
    expect(assignmentErrorKey(403, { unassigning: false })).toBe("assignForbidden");
  });

  // Mismo código, causa distinta. Se distingue con lo que el cliente ya
  // sabe —mandó `null`— y no leyendo el texto inglés de la respuesta.
  it("403 al soltar: un asesor no puede dejarla sin asignar", () => {
    expect(assignmentErrorKey(403, { unassigning: true })).toBe("assignCannotUnassign");
  });

  it("404: dejó de verla", () => {
    expect(assignmentErrorKey(404, { unassigning: false })).toBe("assignNotFound");
  });

  it("429: el cubo de tasa del endpoint", () => {
    expect(assignmentErrorKey(429, { unassigning: false })).toBe("assignRateLimited");
  });

  it("cualquier otro estado cae al genérico, sin inventar un motivo", () => {
    for (const status of [401, 409, 500, 502, 0]) {
      expect(assignmentErrorKey(status, { unassigning: false })).toBe("assignFailed");
      expect(assignmentErrorKey(status, { unassigning: true })).toBe("assignFailed");
    }
  });

  it("cada clave existe en el catálogo y está en español", () => {
    const keys = [
      assignmentErrorKey(400, { unassigning: false }),
      assignmentErrorKey(403, { unassigning: false }),
      assignmentErrorKey(403, { unassigning: true }),
      assignmentErrorKey(404, { unassigning: false }),
      assignmentErrorKey(429, { unassigning: false }),
      assignmentErrorKey(500, { unassigning: false }),
    ];

    for (const key of keys) {
      const value = MESSAGES.Inbox.messageThread[key];
      expect(value, `falta Inbox.messageThread.${key}`).toBeTruthy();
      // Nada de volcar el error crudo del servidor, que es inglés.
      expect(value).not.toMatch(/Failed to|row-level security|HTTP \d/);
    }
  });
});

// Tarea 3sexies.7 — la bandeja deja de escribir directo contra la base.
//
// Va sobre la fuente porque lo que hay que impedir es la reaparición del
// UPDATE: es un defecto que estuvo vivo en producción seis meses sin que
// nadie lo notara, justamente porque a los `admin` les funcionaba y
// ninguna prueba lo cubría.
describe("la bandeja asigna por el endpoint, no por la base", () => {
  it("ya no hace el UPDATE de assigned_agent_id desde el navegador", () => {
    expect(THREAD).not.toMatch(/update\(\s*\{\s*assigned_agent_id/);
  });

  it("llama al PATCH del endpoint con el cuerpo que espera", () => {
    expect(THREAD).toContain("`/api/conversations/${conversation.id}/assignee`");
    expect(THREAD).toMatch(/method:\s*'PATCH'/);
    expect(THREAD).toMatch(/JSON\.stringify\(\{\s*assigned_agent_id:\s*agentId\s*\}\)/);
  });

  it("traduce el fallo en vez de mostrar el mensaje del servidor", () => {
    expect(THREAD).toMatch(
      /assignmentErrorKey\(res\.status,\s*\{\s*unassigning:\s*agentId === null\s*\}\)/,
    );
    expect(THREAD).not.toContain("toast.error('Failed to update assignment')");
  });

  it("solo confirma el cambio en la interfaz cuando el endpoint respondió bien", () => {
    // `onAssignChange` mueve la conversación en la lista. Llamarlo tras
    // un fallo dejaría la bandeja mostrando una asignación que la base
    // nunca aceptó — que es lo que se veía antes, pero al revés.
    const handler =
      /const handleAssignChange = useCallback\(([\s\S]*?)\n {4}\[conversation/.exec(
        THREAD,
      )?.[1] ?? "";

    expect(handler, "no se encontró handleAssignChange").toBeTruthy();
    expect(handler.indexOf("onAssignChange")).toBeGreaterThan(handler.indexOf("res.ok"));
    // Todo camino de error sale antes de confirmar.
    expect(handler.match(/return;/g) ?? []).toHaveLength(3);
  });
});

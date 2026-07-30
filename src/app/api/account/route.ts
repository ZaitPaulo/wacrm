// ============================================================
// /api/account
//
//   GET   — current caller's account + role + showcase config. Any member.
//   PATCH — update account name and/or the public-showcase settings. Admin+.
//
// Why both verbs share a route file
//   They speak about the same singular resource (the caller's
//   account) and reuse the same `requireRole` plumbing. Splitting
//   them across files would duplicate the `account_id` lookup
//   without buying anything.
// ============================================================

import { NextResponse } from "next/server";

import {
  requireRole,
  getCurrentAccount,
  toErrorResponse,
} from "@/lib/auth/account";
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from "@/lib/rate-limit";

export async function GET() {
  try {
    const ctx = await getCurrentAccount();
    // Showcase fields live on the accounts row (migration 503); load them
    // alongside the base account meta so Settings can render the panel.
    const { data: extra } = await ctx.supabase
      .from("accounts")
      .select(
        "showcase_enabled, public_whatsapp, public_name, public_logo_url, public_address, public_phone, public_email, public_hours",
      )
      .eq("id", ctx.accountId)
      .maybeSingle();
    return NextResponse.json({
      account: {
        ...ctx.account,
        showcase_enabled: extra?.showcase_enabled ?? false,
        public_whatsapp: extra?.public_whatsapp ?? null,
        public_name: extra?.public_name ?? null,
        public_logo_url: extra?.public_logo_url ?? null,
        public_address: extra?.public_address ?? null,
        public_phone: extra?.public_phone ?? null,
        public_email: extra?.public_email ?? null,
        public_hours: extra?.public_hours ?? null,
      },
      role: ctx.role,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const MAX_NAME_LEN = 80;

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("admin");

    // Per-user limit on admin-class mutations. Bounds accidental
    // abuse (script run in a loop) and a compromised admin session.
    const limit = checkRateLimit(
      `admin:account:${ctx.userId}`,
      RATE_LIMITS.adminAction,
    );
    if (!limit.success) return rateLimitResponse(limit);

    const body = (await request.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body) {
      return NextResponse.json({ error: "Invalid body" }, { status: 400 });
    }

    const update: Record<string, unknown> = {};

    if (body.name !== undefined) {
      if (typeof body.name !== "string") {
        return NextResponse.json(
          { error: "'name' must be a string" },
          { status: 400 },
        );
      }
      const name = body.name.trim();
      if (name.length === 0) {
        return NextResponse.json(
          { error: "Account name cannot be empty" },
          { status: 400 },
        );
      }
      if (name.length > MAX_NAME_LEN) {
        return NextResponse.json(
          { error: `Account name must be ${MAX_NAME_LEN} characters or fewer` },
          { status: 400 },
        );
      }
      update.name = name;
    }

    if (body.showcase_enabled !== undefined) {
      if (typeof body.showcase_enabled !== "boolean") {
        return NextResponse.json(
          { error: "'showcase_enabled' must be a boolean" },
          { status: 400 },
        );
      }
      update.showcase_enabled = body.showcase_enabled;
    }

    if (body.public_whatsapp !== undefined) {
      if (body.public_whatsapp === null || body.public_whatsapp === "") {
        update.public_whatsapp = null;
      } else if (typeof body.public_whatsapp === "string") {
        // Almacenamos solo dígitos (formato internacional para wa.me).
        const digits = body.public_whatsapp.replace(/\D/g, "");
        if (digits.length < 7 || digits.length > 15) {
          return NextResponse.json(
            { error: "El número de WhatsApp no es válido (7–15 dígitos)." },
            { status: 400 },
          );
        }
        update.public_whatsapp = digits;
      } else {
        return NextResponse.json(
          { error: "'public_whatsapp' must be a string" },
          { status: 400 },
        );
      }
    }

    // Perfil público del negocio (footer): textos libres anulables.
    const textFields = [
      "public_name",
      "public_logo_url",
      "public_address",
      "public_phone",
      "public_email",
      "public_hours",
    ] as const;
    for (const f of textFields) {
      const raw = body[f];
      if (raw === undefined) continue;
      if (raw === null) {
        update[f] = null;
      } else if (typeof raw === "string") {
        update[f] = raw.trim() || null;
      } else {
        return NextResponse.json(
          { error: `'${f}' must be a string` },
          { status: 400 },
        );
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    // RLS allows this UPDATE because accounts_update requires
    // `is_account_member(id, 'admin')`, guaranteed by requireRole above.
    const { data, error } = await ctx.supabase
      .from("accounts")
      .update(update)
      .eq("id", ctx.accountId)
      .select("id, name, showcase_enabled, public_whatsapp")
      .single();

    if (error) {
      // Índice único parcial: solo una cuenta puede ser la vitrina.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "Otra cuenta ya está configurada como vitrina pública." },
          { status: 409 },
        );
      }
      console.error("[PATCH /api/account] update error:", error);
      return NextResponse.json(
        { error: "Failed to update account" },
        { status: 500 },
      );
    }

    return NextResponse.json({ account: data });
  } catch (err) {
    return toErrorResponse(err);
  }
}

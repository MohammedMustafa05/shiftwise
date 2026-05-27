import { Router } from "express";
import { query } from "../db/pool.js";
import { authMiddleware } from "../middleware/auth.js";
import { requireRole } from "../middleware/roleGuard.js";
import { getClearviewClient } from "../integrations/clearview/index.js";
import { encrypt } from "../utils/crypto.js";
import { httpError } from "../middleware/errorHandler.js";

export const clearviewRouter = Router();

clearviewRouter.get("/connect", authMiddleware, requireRole("EMPLOYER"), async (req, res, next) => {
  try {
    if (!req.auth?.workplaceId) throw httpError(400, "No workplace");
    const client = getClearviewClient();
    const state = Buffer.from(
      JSON.stringify({ workplaceId: req.auth.workplaceId, userId: req.auth.sub })
    ).toString("base64url");
    const connectUrl = client.getAuthorizationUrl(state);
    res.json({ mode: client.mode, connectUrl });
  } catch (e) {
    next(e);
  }
});

clearviewRouter.get("/callback", async (req, res, next) => {
  try {
    const code = String(req.query.code ?? "");
    const stateRaw = String(req.query.state ?? "");
    if (!code) throw httpError(400, "Missing code");

    let workplaceId: string;
    try {
      const state = JSON.parse(Buffer.from(stateRaw, "base64url").toString()) as {
        workplaceId: string;
      };
      workplaceId = state.workplaceId;
    } catch {
      throw httpError(400, "Invalid state");
    }

    const wp = await query<{ clearview_store_code: string | null }>(
      `SELECT clearview_store_code FROM workplaces WHERE id = $1`,
      [workplaceId]
    );
    if (wp.rows.length === 0) throw httpError(404, "Workplace not found");

    const client = getClearviewClient();
    const tokens = await client.exchangeCode(code);
    const storeId = wp.rows[0].clearview_store_code ?? "STORE-001";

    await query(
      `INSERT INTO clearview_connections
       (workplace_id, store_id, access_token_encrypted, refresh_token_encrypted, token_expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workplace_id) DO UPDATE SET
         store_id = EXCLUDED.store_id,
         access_token_encrypted = EXCLUDED.access_token_encrypted,
         refresh_token_encrypted = EXCLUDED.refresh_token_encrypted,
         token_expires_at = EXCLUDED.token_expires_at,
         updated_at = now()`,
      [
        workplaceId,
        storeId,
        encrypt(tokens.accessToken),
        tokens.refreshToken ? encrypt(tokens.refreshToken) : null,
        tokens.expiresAt ?? null,
      ]
    );

    if (req.query.format === "json") {
      res.json({ ok: true, workplaceId, mode: client.mode });
      return;
    }
    res.json({ ok: true, workplaceId, mode: client.mode, message: "Clearview connected" });
  } catch (e) {
    next(e);
  }
});


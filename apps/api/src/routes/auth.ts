import { Router } from "express";
import bcrypt from "bcryptjs";
import {
  LoginRequest,
  SignupRequest,
  JoinRequest,
  AuthResponse,
} from "@shiftwise/shared";
import { query } from "../db/pool.js";
import { signToken } from "../middleware/auth.js";
import { httpError } from "../middleware/errorHandler.js";

export const authRouter = Router();

authRouter.post("/signup", async (req, res, next) => {
  try {
    const body = SignupRequest.parse(req.body);
    const existing = await query(`SELECT id FROM users WHERE email = $1`, [body.email]);
    if (existing.rows.length > 0) {
      throw httpError(409, "Email already registered");
    }

    const slug = body.workplaceName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const wp = await query<{ id: string }>(
      `INSERT INTO workplaces (name, slug, timezone, preferences)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        body.workplaceName,
        `${slug}-${Date.now().toString(36)}`,
        body.timezone ?? "America/Toronto",
        JSON.stringify({ labourCostPct: 0.2, constraints: {} }),
      ]
    );
    const workplaceId = wp.rows[0].id;

    await query(
      `INSERT INTO workplace_invites (workplace_id, slug) VALUES ($1, $2)`,
      [workplaceId, slug]
    );

    const hash = await bcrypt.hash(body.password, 10);
    const user = await query<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, password_hash, role, workplace_id, name)
       VALUES ($1, $2, 'EMPLOYER', $3, $4) RETURNING id, email, name`,
      [body.email, hash, workplaceId, body.name]
    );

    const u = user.rows[0];
    const token = signToken({
      sub: u.id,
      email: u.email,
      role: "EMPLOYER",
      workplaceId,
    });

    const response: AuthResponse = {
      token,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: "EMPLOYER",
        workplaceId,
      },
    };
    res.status(201).json(response);
  } catch (e) {
    next(e);
  }
});

authRouter.post("/login", async (req, res, next) => {
  try {
    const body = LoginRequest.parse(req.body);
    const result = await query<{
      id: string;
      email: string;
      name: string;
      role: "EMPLOYER" | "EMPLOYEE";
      workplace_id: string | null;
      password_hash: string;
    }>(`SELECT id, email, name, role, workplace_id, password_hash FROM users WHERE email = $1`, [
      body.email,
    ]);
    if (result.rows.length === 0) throw httpError(401, "Invalid credentials");
    const u = result.rows[0];
    const ok = await bcrypt.compare(body.password, u.password_hash);
    if (!ok) throw httpError(401, "Invalid credentials");

    const token = signToken({
      sub: u.id,
      email: u.email,
      role: u.role,
      workplaceId: u.workplace_id,
    });

    const response: AuthResponse = {
      token,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        workplaceId: u.workplace_id,
      },
    };
    res.json(response);
  } catch (e) {
    next(e);
  }
});

authRouter.post("/join/:slug", async (req, res, next) => {
  try {
    const body = JoinRequest.parse(req.body);
    const invite = await query<{ workplace_id: string }>(
      `SELECT wi.workplace_id FROM workplace_invites wi
       JOIN workplaces w ON w.id = wi.workplace_id
       WHERE wi.slug = $1 OR w.slug = $1 LIMIT 1`,
      [req.params.slug]
    );
    if (invite.rows.length === 0) throw httpError(404, "Invalid invite");

    const workplaceId = invite.rows[0].workplace_id;
    const existing = await query(`SELECT id FROM users WHERE email = $1`, [body.email]);
    if (existing.rows.length > 0) throw httpError(409, "Email already registered");

    const hash = await bcrypt.hash(body.password, 10);
    const user = await query<{ id: string; email: string; name: string }>(
      `INSERT INTO users (email, password_hash, role, workplace_id, name)
       VALUES ($1, $2, 'EMPLOYEE', $3, $4) RETURNING id, email, name`,
      [body.email, hash, workplaceId, body.name]
    );
    const u = user.rows[0];

    await query(
      `INSERT INTO employee_profiles (user_id, workplace_id, role)
       VALUES ($1, $2, 'STAFF')`,
      [u.id, workplaceId]
    );

    const token = signToken({
      sub: u.id,
      email: u.email,
      role: "EMPLOYEE",
      workplaceId,
    });

    res.status(201).json({
      token,
      user: {
        id: u.id,
        email: u.email,
        name: u.name,
        role: "EMPLOYEE",
        workplaceId,
      },
    } satisfies AuthResponse);
  } catch (e) {
    next(e);
  }
});

import request from "supertest";
import type { Express } from "express";

export async function signupEmployer(app: Express, suffix = "") {
  const unique = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `employer${unique}@test.com`;
  const res = await request(app)
    .post("/api/auth/signup")
    .send({
      email,
      password: "password123",
      name: "Test Manager",
      workplaceName: `Test Restaurant ${unique}`,
    });
  return { res, email, token: res.body.token as string, workplaceId: res.body.user.workplaceId as string };
}

export async function login(app: Express, email: string) {
  return request(app).post("/api/auth/login").send({ email, password: "password123" });
}

export async function joinEmployee(app: Express, slug: string, suffix = "") {
  const unique = `${suffix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const email = `employee${unique}@test.com`;
  const res = await request(app)
    .post(`/api/auth/join/${slug}`)
    .send({ email, password: "password123", name: `Employee ${suffix}` });
  return { res, email, token: res.body.token as string, userId: res.body.user.id as string };
}

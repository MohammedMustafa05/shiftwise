import { describe, it, expect } from "vitest";
import {
  parseAndValidateLLMOutput,
  LLMOutputParseError,
  extractJsonPayload,
} from "../src/lib/llm/outputParser.js";

const validShift = {
  employee_id: "11111111-1111-1111-1111-111111111111",
  date: "2026-06-01",
  start_time: "09:00",
  end_time: "17:00",
  role: "COOK",
  reasoning: "Top cook for the Monday rush.",
  confidence: 0.9,
};

describe("parseAndValidateLLMOutput", () => {
  it("parses valid JSON into a typed object", () => {
    const out = parseAndValidateLLMOutput(
      JSON.stringify({ shifts: [validShift], unfilled_slots: [], summary: "ok", warnings: [] })
    );
    expect(out.shifts).toHaveLength(1);
    expect(out.shifts[0].role).toBe("COOK");
    expect(out.summary).toBe("ok");
  });

  it("throws when shifts key is missing", () => {
    expect(() => parseAndValidateLLMOutput(JSON.stringify({ summary: "x" }))).toThrow(
      LLMOutputParseError
    );
  });

  it("throws on an invalid role", () => {
    expect(() =>
      parseAndValidateLLMOutput(JSON.stringify({ shifts: [{ ...validShift, role: "MANAGER" }] }))
    ).toThrow(LLMOutputParseError);
  });

  it("strips markdown code fences and parses", () => {
    const fenced = "```json\n" + JSON.stringify({ shifts: [validShift] }) + "\n```";
    const out = parseAndValidateLLMOutput(fenced);
    expect(out.shifts).toHaveLength(1);
  });

  it("defaults confidence to 0.7 when absent", () => {
    const { confidence: _omit, ...noConfidence } = validShift;
    const out = parseAndValidateLLMOutput(JSON.stringify({ shifts: [noConfidence] }));
    expect(out.shifts[0].confidence).toBe(0.7);
  });

  it("throws on non-JSON output", () => {
    expect(() => parseAndValidateLLMOutput("not json at all")).toThrow(LLMOutputParseError);
  });

  it("extracts JSON object from leading prose", () => {
    const payload = JSON.stringify({ shifts: [validShift], unfilled_slots: [], summary: "ok", warnings: [] });
    const wrapped = `Here is the schedule you requested:\n${payload}\nLet me know if you need changes.`;
    const out = parseAndValidateLLMOutput(wrapped);
    expect(out.shifts).toHaveLength(1);
  });

  it("extractJsonPayload finds object in prose", () => {
    const json = '{"shifts":[],"summary":"x","warnings":[],"unfilled_slots":[]}';
    expect(extractJsonPayload(`Sure! ${json}`)).toBe(json);
  });
});

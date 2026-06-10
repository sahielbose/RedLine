/**
 * audit.ts — HERMETIC test (spec §6, §8). No DB: `buildAuditEntry` is pure, so
 * this runs in the default green gate with no socket opened. It pins the audit
 * row SHAPE (the §6 audit_log columns) and the no-fabrication invariants.
 */
import { describe, it, expect } from "vitest";

import { buildAuditEntry, SYSTEM_ACTOR } from "@/lib/audit";

describe("buildAuditEntry (pure, spec §6 audit_log shape)", () => {
  it("maps inputs to the audit_log column shape with before AND after", () => {
    const before = { id: "m1", status: "draft" };
    const after = { id: "m1", status: "approved" };

    const entry = buildAuditEntry({
      orgId: "org-1",
      actor: "user-7",
      action: "memo.approved",
      entityType: "memo",
      entityId: "m1",
      before,
      after,
    });

    expect(entry).toEqual({
      orgId: "org-1",
      actor: "user-7",
      action: "memo.approved",
      entityType: "memo",
      entityId: "m1",
      before,
      after,
    });
  });

  it("exposes exactly the audit_log insert keys (no created_at — DB supplies now())", () => {
    const entry = buildAuditEntry({
      orgId: "org-1",
      actor: SYSTEM_ACTOR,
      action: "memo.draft.created",
      entityType: "memo",
      entityId: "m2",
      after: { id: "m2", status: "draft" },
    });

    // created_at is intentionally absent so the column default (now()) wins —
    // we never fabricate a timestamp (no-fabrication guardrail).
    expect(Object.keys(entry).sort()).toEqual(
      ["action", "actor", "after", "before", "entityId", "entityType", "orgId"].sort(),
    );
    expect(entry).not.toHaveProperty("createdAt");
    expect(entry).not.toHaveProperty("id");
  });

  it("defaults before/after to null (a create has no before; a delete no after)", () => {
    const created = buildAuditEntry({
      orgId: "org-1",
      actor: SYSTEM_ACTOR,
      action: "memo.draft.created",
      entityType: "memo",
      entityId: "m3",
      after: { id: "m3" },
    });
    expect(created.before).toBeNull();
    expect(created.after).toEqual({ id: "m3" });

    const deleted = buildAuditEntry({
      orgId: "org-1",
      actor: "user-7",
      action: "memo.purged",
      entityType: "memo",
      entityId: "m4",
      before: { id: "m4" },
    });
    expect(deleted.after).toBeNull();
    expect(deleted.before).toEqual({ id: "m4" });
  });

  it("accepts the 'system' sentinel actor and a null orgId", () => {
    expect(SYSTEM_ACTOR).toBe("system");
    const entry = buildAuditEntry({
      orgId: null,
      actor: SYSTEM_ACTOR,
      action: "sync.ran",
      entityType: "sync_state",
      entityId: null,
    });
    expect(entry.orgId).toBeNull();
    expect(entry.actor).toBe("system");
    expect(entry.entityId).toBeNull();
    expect(entry.before).toBeNull();
    expect(entry.after).toBeNull();
  });
});

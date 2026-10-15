import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHelpdeskAlerts,
  validateManagerQuestion
} from "../src/server/helpdesk-manager.js";

const NOW = new Date("2026-10-16T08:00:00.000Z");

function ticket(overrides = {}) {
  return {
    id: "internal-1",
    ticketNumber: "HD-1001",
    subject: "Printer unavailable",
    category: "Printer",
    status: "Open",
    priority: "Low",
    caseType: "Minor",
    createdAt: "2026-10-16T04:00:00.000Z",
    updatedAt: "2026-10-16T04:00:00.000Z",
    closedAt: null,
    assignedTo: "Aina",
    department: "Finance",
    location: "HQ",
    ...overrides
  };
}

test("validates trimmed manager questions at the 1000 character boundary", () => {
  assert.deepEqual(validateManagerQuestion("   "), {
    valid: false,
    question: "",
    error: "Enter a helpdesk status question."
  });
  assert.deepEqual(validateManagerQuestion(`  ${"a".repeat(1000)}  `), {
    valid: true,
    question: "a".repeat(1000),
    error: null
  });
  assert.equal(validateManagerQuestion("a".repeat(1001)).valid, false);
  assert.equal(validateManagerQuestion("a".repeat(1001)).error, "Question must be 1,000 characters or fewer.");
});

test("creates alerts only beyond SLA and stalled thresholds", () => {
  const alerts = buildHelpdeskAlerts({
    now: NOW,
    tickets: [
      ticket({ ticketNumber: "MIN-EXACT", createdAt: "2026-10-16T03:00:00.000Z" }),
      ticket({ ticketNumber: "MIN-LATE", createdAt: "2026-10-16T02:59:24.000Z" }),
      ticket({ ticketNumber: "MAJ-EXACT", caseType: "Major", createdAt: "2026-10-14T20:00:00.000Z" }),
      ticket({ ticketNumber: "MAJ-LATE", caseType: "Major", createdAt: "2026-10-14T19:59:24.000Z" }),
      ticket({ ticketNumber: "STALL-EXACT", caseType: "", status: "In Progress", createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-15T08:00:00.000Z" }),
      ticket({ ticketNumber: "STALL-LATE", caseType: "", status: "In Progress", createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-15T07:59:24.000Z" })
    ]
  });

  const pairs = alerts.map(({ ticketNumber, rule }) => `${ticketNumber}:${rule}`);
  assert.equal(pairs.includes("MIN-EXACT:minor_sla_overdue"), false);
  assert.equal(pairs.includes("MAJ-EXACT:major_sla_overdue"), false);
  assert.equal(pairs.includes("STALL-EXACT:stalled_in_progress"), false);
  assert.equal(pairs.includes("MIN-LATE:minor_sla_overdue"), true);
  assert.equal(pairs.includes("MAJ-LATE:major_sla_overdue"), true);
  assert.equal(pairs.includes("STALL-LATE:stalled_in_progress"), true);
});

test("normalizes fields and excludes resolved closed and deleted tickets", () => {
  const alerts = buildHelpdeskAlerts({
    now: NOW,
    tickets: [
      ticket({ ticketNumber: "ACTIVE", caseType: " minor ", status: " OPEN ", priority: " HIGH ", createdAt: "2026-10-15T00:00:00.000Z", assignedTo: "" }),
      ticket({ ticketNumber: "RESOLVED", status: " resolved ", priority: "Critical", assignedTo: "" }),
      ticket({ ticketNumber: "CLOSED", status: " CLOSED ", priority: "Critical", assignedTo: "" }),
      ticket({ ticketNumber: "DELETED", deletedAt: "2026-10-16T06:00:00.000Z", priority: "Critical", assignedTo: "" })
    ]
  });

  assert.deepEqual([...new Set(alerts.map((alert) => alert.ticketNumber))], ["ACTIVE"]);
  assert.deepEqual(new Set(alerts.map((alert) => alert.rule)), new Set(["minor_sla_overdue", "high_priority_unresolved", "unassigned"]));
});

test("orders alerts by severity and permits multiple rules per ticket", () => {
  const alerts = buildHelpdeskAlerts({
    now: NOW,
    tickets: [
      ticket({ ticketNumber: "HD-CRITICAL", caseType: "Major", priority: "Critical", status: "In Progress", assignedTo: "", createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" }),
      ticket({ ticketNumber: "HD-HIGH", priority: "Low", createdAt: "2026-10-15T00:00:00.000Z" }),
      ticket({ ticketNumber: "HD-MEDIUM", caseType: "", assignedTo: "" })
    ]
  });

  const severityRank = { Critical: 0, High: 1, Medium: 2 };
  assert.deepEqual(alerts.map((alert) => severityRank[alert.severity]), [...alerts.map((alert) => severityRank[alert.severity])].sort());
  assert.ok(alerts.filter((alert) => alert.ticketNumber === "HD-CRITICAL").length >= 4);
  assert.equal(alerts[0].ticketNumber, "HD-CRITICAL");
  assert.equal(alerts.at(-1).severity, "Medium");
});

test("ignores invalid and future timestamps for age based alerts", () => {
  const alerts = buildHelpdeskAlerts({
    now: NOW,
    tickets: [
      ticket({ ticketNumber: "INVALID", createdAt: "not-a-date", updatedAt: "not-a-date" }),
      ticket({ ticketNumber: "FUTURE", createdAt: "2026-10-17T08:00:00.000Z", updatedAt: "2026-10-17T08:00:00.000Z" }),
      ticket({ ticketNumber: "FUTURE-STALL", caseType: "", status: "In Progress", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-17T08:00:00.000Z" })
    ]
  });

  assert.deepEqual(alerts, []);
});

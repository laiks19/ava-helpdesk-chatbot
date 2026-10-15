import assert from "node:assert/strict";
import test from "node:test";

import {
  buildHelpdeskAlerts,
  buildManagerOpenAiInput,
  buildManagerSnapshot,
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

test("builds an allowlisted snapshot without requester or database identifiers", () => {
  const sourceTicket = ticket({
    requesterName: "Private Person",
    requesterEmail: "private@example.com",
    email: "private@example.com",
    description: "Contains private troubleshooting notes",
    resolutionNote: "Internal-only note"
  });
  const alerts = buildHelpdeskAlerts({ tickets: [sourceTicket], now: NOW });
  const snapshot = buildManagerSnapshot({
    dashboard: {
      tickets: [sourceTicket],
      kpis: { total: 1, open: 1 },
      technicianKpis: [{ technicianName: "Aina", totalTickets: 1, open: 1 }],
      technicians: [{ id: "tech-secret-id", name: "Aina", email: "aina@example.com" }]
    },
    alerts,
    checkedAt: NOW.toISOString()
  });

  assert.deepEqual(Object.keys(snapshot.tickets[0]), [
    "ticketNumber", "subject", "category", "status", "priority", "caseType",
    "createdAt", "updatedAt", "closedAt", "technicianName", "department", "location", "alertReasons"
  ]);
  const serialized = JSON.stringify(snapshot);
  assert.equal(serialized.includes("internal-1"), false);
  assert.equal(serialized.includes("Private Person"), false);
  assert.equal(serialized.includes("private@example.com"), false);
  assert.equal(serialized.includes("tech-secret-id"), false);
  assert.equal(serialized.includes("Internal-only note"), false);
});

test("orders active tickets before resolved tickets and truncates at 100", () => {
  const tickets = Array.from({ length: 101 }, (_, index) => ticket({
    id: `internal-${index}`,
    ticketNumber: `HD-${String(index).padStart(4, "0")}`,
    status: index === 100 ? "Resolved" : "Open",
    createdAt: new Date(NOW.getTime() - index * 60_000).toISOString(),
    updatedAt: new Date(NOW.getTime() - index * 60_000).toISOString()
  }));
  const snapshot = buildManagerSnapshot({ dashboard: { tickets }, alerts: [], checkedAt: NOW.toISOString() });

  assert.equal(snapshot.includedTicketCount, 100);
  assert.equal(snapshot.totalTicketCount, 101);
  assert.equal(snapshot.truncated, true);
  assert.equal(snapshot.tickets[0].ticketNumber, "HD-0000");
  assert.equal(snapshot.tickets.some((item) => item.status === "Resolved"), false);
});

test("builds a prompt that treats ticket text as untrusted read only data", () => {
  const snapshot = buildManagerSnapshot({ dashboard: { tickets: [ticket()] }, alerts: [], checkedAt: NOW.toISOString() });
  const input = buildManagerOpenAiInput({ question: "What needs attention?", snapshot });

  assert.deepEqual(input.map((message) => message.role), ["system", "user"]);
  assert.match(input[0].content, /supplied helpdesk snapshot only/i);
  assert.match(input[0].content, /untrusted data/i);
  assert.match(input[0].content, /never claim.*modified/i);
  assert.match(input[0].content, /never provide or request credentials/i);
  assert.match(input[0].content, /reference ticket numbers/i);
  assert.match(input[0].content, /state.*cannot answer/i);
  assert.match(input[1].content, /What needs attention\?/);
  assert.match(input[1].content, /BEGIN UNTRUSTED HELPDESK SNAPSHOT/);
  assert.match(input[1].content, /END UNTRUSTED HELPDESK SNAPSHOT/);
});

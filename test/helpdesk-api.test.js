import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHelpdeskStore, shapeTicketCreationResponse, toPublicDashboard } from "../src/server/helpdesk-store.js";
import { createAuthService } from "../src/server/auth-service.js";
import { runHelpdeskManagerQuery } from "../src/server/helpdesk-manager.js";

const validTicket = {
  requesterName: "Mei Lin",
  email: "mei@example.com",
  department: "Finance",
  category: "Hardware",
  priority: "High",
  subject: "Laptop screen is black",
  description: "The screen remains black after restart."
};

test("local helpdesk store persists technician assignment and soft deletion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ava-helpdesk-store-"));
  try {
    const store = createHelpdeskStore({
      localPaths: {
        tickets: path.join(directory, "tickets.json"),
        users: path.join(directory, "users.json"),
        technicians: path.join(directory, "technicians.json")
      }
    });
    await store.initialize();
    const technician = await store.createTechnician({ name: "Alex Tan", email: "alex@example.com" }, "admin-local");
    const ticket = await store.createTicket(validTicket, { source: "admin", requesterUserId: "user-1" });
    const assigned = await store.updateTicket(ticket.id, {
      assignedTechnicianId: technician.id,
      assignedTo: technician.name,
      status: "In Progress"
    }, "admin-local");
    const deleted = await store.deleteTicket(ticket.id, "admin-local");

    assert.equal(assigned.assignedTo, "Alex Tan");
    assert.equal(assigned.status, "In Progress");
    assert.ok(deleted.deletedAt);
    assert.equal((await store.listTickets()).length, 0);
    assert.equal((await store.listTickets({ includeDeleted: true })).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("authorization rejects pending users and accepts approved administrators", async () => {
  const profiles = {
    "pending-user": {
      id: "pending-user",
      email: "pending@example.com",
      role: "user",
      approvalStatus: "pending",
      isActive: true
    },
    "admin-user": {
      id: "admin-user",
      email: "admin@example.com",
      role: "admin",
      approvalStatus: "approved",
      isActive: true
    }
  };
  const supabase = {
    auth: {
      getUser: async (token) => ({
        data: { user: { id: token === "admin-token" ? "admin-user" : "pending-user" } },
        error: null
      })
    },
    from: () => ({
      select: () => ({
        eq: (_column, id) => ({
          single: async () => ({ data: profiles[id], error: null })
        })
      })
    })
  };
  const auth = createAuthService({ supabase, localAdminToken: "local-admin-token" });

  await assert.rejects(() => auth.requireRole("pending-token", "user"), (error) => error.status === 403);
  const pending = await auth.authenticate("pending-token");
  assert.equal(pending.approvalStatus, "pending");
  const admin = await auth.requireRole("admin-token", "admin");
  assert.equal(admin.role, "admin");
  const localAdmin = await auth.requireRole("local-admin-token", "admin");
  assert.equal(localAdmin.email, "kokseng.lai@ecoworld.my");
  assert.equal(localAdmin.mustChangePassword, true);
});

test("local store manages pending users and technician KPI data", async () => {
  const store = createHelpdeskStore();
  await store.initialize();
  const user = await store.createUser({
    fullName: "Nadia Lee",
    email: "nadia@example.com",
    department: "Sales",
    role: "user",
    approvalStatus: "pending"
  });
  const approved = await store.updateUser(user.id, {
    approvalStatus: "approved",
    approvedBy: "admin-local"
  });
  const technician = await store.createTechnician({ name: "Alex Tan" }, "admin-local");
  const ticket = await store.createTicket(validTicket);
  await store.updateTicket(ticket.id, {
    assignedTechnicianId: technician.id,
    assignedTo: technician.name,
    status: "Closed"
  });
  const dashboard = await store.getDashboard();

  assert.equal(approved.approvalStatus, "approved");
  assert.equal(dashboard.technicianKpis[0].closed, 1);
  assert.equal(dashboard.kpis.totalTickets, 1);
});

test("dashboard filters tickets and technician KPIs by ticket creation date", async () => {
  const store = createHelpdeskStore();
  await store.initialize();
  const technician = await store.createTechnician({ name: "Alex Tan" }, "admin-local");
  const ticket = await store.createTicket(validTicket);
  await store.updateTicket(ticket.id, { assignedTechnicianId: technician.id, assignedTo: technician.name });

  const dashboard = await store.getDashboard({ dateFrom: "2999-01-01", dateTo: "2999-01-31" });

  assert.deepEqual(dashboard.tickets, []);
  assert.equal(dashboard.kpis.totalTickets, 0);
  assert.equal(dashboard.technicianKpis[0].total, 0);
  assert.deepEqual(dashboard.filters, { dateFrom: "2999-01-01", dateTo: "2999-01-31" });
});

test("local helpdesk store persists administrator KPI settings", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ava-helpdesk-kpi-settings-"));
  const localPaths = {
    tickets: path.join(directory, "tickets.json"),
    users: path.join(directory, "users.json"),
    technicians: path.join(directory, "technicians.json"),
    kpiSettings: path.join(directory, "kpi-settings.json")
  };
  try {
    const store = createHelpdeskStore({ localPaths });
    await store.initialize();
    assert.deepEqual((await store.getDashboard()).kpiSettings, {
      minorTargetHours: 5,
      majorTargetHours: 36
    });

    await store.updateKpiSettings({ minorTargetHours: 8, majorTargetHours: 48 }, "admin-local");
    const restarted = createHelpdeskStore({ localPaths });
    await restarted.initialize();

    assert.deepEqual((await restarted.getDashboard()).kpiSettings, {
      minorTargetHours: 8,
      majorTargetHours: 48
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("public dashboard removes requester and private ticket details", () => {
  const dashboard = toPublicDashboard({
    tickets: [{
      id: "HD-0001",
      subject: "VPN access",
      requesterName: "Mei Lin",
      email: "mei@example.com",
      description: "Contains a private error message",
      department: "Finance",
      priority: "High",
      status: "Open",
      assignedTo: "Alex Tan",
      createdAt: "2026-09-25T00:00:00.000Z"
    }],
    kpis: { totalTickets: 1 },
    technicianKpis: [{ name: "Alex Tan", open: 1 }],
    technicians: [{ id: "tech-1", name: "Alex Tan", email: "alex@example.com", isActive: true }]
  });

  assert.deepEqual(dashboard.tickets[0], {
    id: "HD-0001",
    subject: "VPN access",
    department: "Finance",
    priority: "High",
    status: "Open",
    assignedTo: "Alex Tan",
    createdAt: "2026-09-25T00:00:00.000Z"
  });
  assert.equal(dashboard.technicians[0].email, undefined);
  assert.equal(dashboard.kpis.totalTickets, 1);
});

test("guest ticket creation response contains no global tickets or KPIs", () => {
  const ticket = { id: "HD-0003", ...validTicket };
  const response = shapeTicketCreationResponse(ticket);
  assert.deepEqual(response, { ticket });
  assert.equal(response.tickets, undefined);
  assert.equal(response.kpis, undefined);
});

test("dashboard route is administrator-only", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "server", "server.js"), "utf8");
  assert.match(source, /app\.get\("\/api\/admin\/dashboard", requireAdmin/);
  assert.doesNotMatch(source, /app\.get\("\/api\/dashboard"/);
  assert.doesNotMatch(source, /app\.get\("\/api\/tickets"/);
  assert.match(source, /app\.patch\("\/api\/admin\/kpi-settings", requireAdmin/);
});

test("ticket mutations complete before a non-critical KPI refresh", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "client", "admin-console.jsx"), "utf8");
  const saveStart = source.indexOf("async function saveTicket");
  const saveEnd = source.indexOf("async function deleteTicket", saveStart);
  const saveTicket = source.slice(saveStart, saveEnd);

  assert.ok(saveTicket.indexOf("setTicketEditor(null)") < saveTicket.indexOf("setKpiDashboard"));
  assert.match(saveTicket, /kpiRefreshFailed/);
});

test("dashboard falls back to default KPI settings when the settings read is unavailable", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "server", "helpdesk-store.js"), "utf8");
  const loaderStart = source.indexOf("async function getKpiSettings");
  const loaderEnd = source.indexOf("async function updateKpiSettings", loaderStart);
  const loader = source.slice(loaderStart, loaderEnd);

  assert.match(loader, /defaultKpiSettings/);
  assert.match(loader, /if \(error \|\| !data\)/);
});

test("protects the helpdesk manager query with requireAdmin", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "server", "server.js"), "utf8");
  assert.match(source, /app\.post\("\/api\/admin\/helpdesk-manager\/query", requireAdmin/);
});

test("uses dashboard reads and never ticket mutation methods", async () => {
  const source = await readFile(path.join(process.cwd(), "src", "server", "server.js"), "utf8");
  const routeStart = source.indexOf('app.post("/api/admin/helpdesk-manager/query"');
  const routeEnd = source.indexOf("app.", routeStart + 10);
  const managerRoute = source.slice(routeStart, routeEnd);

  assert.match(managerRoute, /helpdeskStore\.getDashboard/);
  assert.doesNotMatch(managerRoute, /createTicket|updateTicket|deleteTicket/);
});

test("returns deterministic alerts with OpenAI unavailable and failed responses", async () => {
  const dashboard = {
    tickets: [{
      id: "internal-1",
      ticketNumber: "HD-2001",
      subject: "Critical VPN outage",
      category: "Network",
      status: "Open",
      priority: "Critical",
      caseType: "Major",
      createdAt: "2026-10-14T00:00:00.000Z",
      updatedAt: "2026-10-14T00:00:00.000Z",
      assignedTo: ""
    }],
    kpis: {},
    technicianKpis: []
  };
  const now = new Date("2026-10-16T08:00:00.000Z");
  const unavailable = await runHelpdeskManagerQuery({
    question: "What is overdue?",
    loadDashboard: async () => dashboard,
    aiAvailable: false,
    now
  });
  const failed = await runHelpdeskManagerQuery({
    question: "What is overdue?",
    loadDashboard: async () => dashboard,
    aiAvailable: true,
    openAiResponder: async () => { throw new Error("provider details must stay private"); },
    now
  });

  assert.equal(unavailable.status, 503);
  assert.match(unavailable.body.error, /unavailable/i);
  assert.ok(unavailable.body.alerts.length >= 3);
  assert.equal(unavailable.body.checkedAt, now.toISOString());
  assert.equal(failed.status, 502);
  assert.match(failed.body.error, /try again/i);
  assert.deepEqual(failed.body.alerts, unavailable.body.alerts);
  assert.equal(JSON.stringify(failed).includes("provider details"), false);
});

test("sends the bounded manager input to the existing OpenAI model", async () => {
  let dashboardReads = 0;
  let responderInput = null;
  const result = await runHelpdeskManagerQuery({
    question: "  Summarize open tickets.  ",
    loadDashboard: async () => {
      dashboardReads += 1;
      return { tickets: [], kpis: {}, technicianKpis: [] };
    },
    aiAvailable: true,
    openAiResponder: async (input) => {
      responderInput = input;
      return "No open tickets are present in the snapshot.";
    },
    now: new Date("2026-10-16T08:00:00.000Z")
  });

  assert.equal(dashboardReads, 1);
  assert.equal(responderInput.question, "Summarize open tickets.");
  assert.deepEqual(responderInput.input.map((message) => message.role), ["system", "user"]);
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, "No open tickets are present in the snapshot.");
  assert.deepEqual(result.body.alerts, []);
});

test("returns deterministic truncation scope with every successful answer", async () => {
  const tickets = Array.from({ length: 101 }, (_, index) => ({
    id: `private-${index}`,
    ticketNumber: `HD-${index}`,
    subject: "Test",
    status: "Open",
    priority: "Low",
    caseType: "Minor",
    createdAt: "2026-10-16T07:30:00.000Z",
    assignedTo: "Aina"
  }));
  const result = await runHelpdeskManagerQuery({
    question: "Summarize the queue.",
    loadDashboard: async () => ({ tickets }),
    aiAvailable: true,
    openAiResponder: async () => "There are 101 tickets.",
    now: new Date("2026-10-16T08:00:00.000Z")
  });

  assert.deepEqual(result.body.scope, {
    truncated: true,
    includedTicketCount: 100,
    totalTicketCount: 101
  });
});

test("sanitizes dashboard load failures without calling OpenAI", async () => {
  let openAiCalls = 0;
  const result = await runHelpdeskManagerQuery({
    question: "Summarize the queue.",
    loadDashboard: async () => { throw new Error("relation helpdesk_tickets_secret does not exist"); },
    aiAvailable: true,
    openAiResponder: async () => { openAiCalls += 1; return "should not run"; }
  });

  assert.equal(result.status, 500);
  assert.deepEqual(result.body, { error: "Helpdesk data could not be loaded. Please try again." });
  assert.equal(openAiCalls, 0);
  assert.equal(JSON.stringify(result).includes("helpdesk_tickets_secret"), false);
});

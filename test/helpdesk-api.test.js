import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createHelpdeskStore, toPublicDashboard } from "../src/server/helpdesk-store.js";
import { createAuthService } from "../src/server/auth-service.js";

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

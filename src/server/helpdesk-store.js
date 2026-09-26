import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  createHelpdeskTicket,
  deleteHelpdeskTicket,
  filterTicketsByCreatedDateRange,
  formatTicketNumber,
  normalizeTicketCaseType,
  summarizeTechnicianKpis,
  summarizeTicketKpis,
  updateHelpdeskTicket,
  validateProfileInput,
  validateTechnicianInput,
  validateTicketInput
} from "./helpdesk-core.js";

export function toPublicDashboard(dashboard = {}) {
  return {
    tickets: (dashboard.tickets || []).map((ticket) => ({
      id: ticket.id,
      subject: ticket.subject,
      department: ticket.department || "",
      priority: ticket.priority,
      status: ticket.status,
      assignedTo: ticket.assignedTo || "",
      createdAt: ticket.createdAt
    })),
    kpis: dashboard.kpis || {},
    technicianKpis: dashboard.technicianKpis || [],
    technicians: (dashboard.technicians || []).map((technician) => ({
      id: technician.id,
      name: technician.name,
      isActive: technician.isActive
    }))
  };
}

export function shapeTicketCreationResponse(ticket) {
  return { ticket };
}

export function createHelpdeskStore({ supabase = null, localPaths = {}, isProduction = false } = {}) {
  if (isProduction && !supabase) {
    throw new Error("Supabase is required in production.");
  }
  return supabase
    ? createSupabaseHelpdeskStore(supabase)
    : createLocalHelpdeskStore(localPaths);
}

function createLocalHelpdeskStore(localPaths) {
  let tickets = [];
  let technicians = [];
  let users = [];

  async function initialize() {
    tickets = (await readJson(localPaths.tickets, [])).map((ticket) => ({
      ...ticket,
      caseType: normalizeTicketCaseType(ticket.caseType)
    }));
    technicians = await readJson(localPaths.technicians, []);
    users = await readJson(localPaths.users, []);
    if (!users.some((user) => user.email === "kokseng.lai@ecoworld.my")) {
      users.unshift({
        id: "admin-local",
        email: "kokseng.lai@ecoworld.my",
        fullName: "Kok Seng Lai",
        department: "MIS",
        role: "admin",
        approvalStatus: "approved",
        isActive: true,
        mustChangePassword: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      await persistUsers();
    }
    return api;
  }

  async function listTickets({ includeDeleted = false } = {}) {
    return tickets
      .filter((ticket) => includeDeleted || !ticket.deletedAt)
      .toSorted((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function createTicket(input, options = {}) {
    const sequence = tickets.reduce((max, ticket) => Math.max(max, Number(ticket.ticketNumber) || ticketSequence(ticket.id)), 0) + 1;
    const ticket = createHelpdeskTicket({
      input,
      sequence,
      source: options.source,
      requesterUserId: options.requesterUserId
    });
    tickets.unshift(ticket);
    await persistTickets();
    return ticket;
  }

  async function updateTicket(id, updates, actorUserId = "") {
    const index = tickets.findIndex((ticket) => ticket.id === id || ticket.recordId === id);
    if (index < 0) throw storeError("Ticket not found.", 404);
    tickets[index] = updateHelpdeskTicket(tickets[index], updates);
    tickets[index].lastUpdatedBy = actorUserId;
    await persistTickets();
    return tickets[index];
  }

  async function deleteTicket(id, actorUserId = "") {
    const index = tickets.findIndex((ticket) => ticket.id === id || ticket.recordId === id);
    if (index < 0) throw storeError("Ticket not found.", 404);
    tickets[index] = deleteHelpdeskTicket(tickets[index], { actorUserId });
    await persistTickets();
    return tickets[index];
  }

  async function listUsers() {
    return users.toSorted((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
  }

  async function createUser(input) {
    const validation = validateProfileInput(input);
    if (!validation.valid) throw storeError(validation.error, 400);
    if (users.some((user) => user.email === validation.profile.email)) {
      throw storeError("A user with this email already exists.", 409);
    }
    const now = new Date().toISOString();
    const user = { id: randomUUID(), ...validation.profile, mustChangePassword: Boolean(input.mustChangePassword), createdAt: now, updatedAt: now };
    users.unshift(user);
    await persistUsers();
    return user;
  }

  async function updateUser(id, updates) {
    const index = users.findIndex((user) => user.id === id);
    if (index < 0) throw storeError("User not found.", 404);
    const current = users[index];
    const merged = {
      fullName: updates.fullName ?? current.fullName,
      email: updates.email ?? current.email,
      department: updates.department ?? current.department,
      role: updates.role ?? current.role,
      approvalStatus: updates.approvalStatus ?? current.approvalStatus,
      isActive: updates.isActive ?? current.isActive
    };
    const validation = validateProfileInput(merged);
    if (!validation.valid) throw storeError(validation.error, 400);
    users[index] = {
      ...current,
      ...validation.profile,
      approvedBy: updates.approvedBy ?? current.approvedBy,
      approvedAt: validation.profile.approvalStatus === "approved"
        ? current.approvedAt || new Date().toISOString()
        : "",
      mustChangePassword: updates.mustChangePassword ?? current.mustChangePassword,
      updatedAt: new Date().toISOString()
    };
    await persistUsers();
    return users[index];
  }

  async function deleteUser(id) {
    const user = users.find((item) => item.id === id);
    if (!user) throw storeError("User not found.", 404);
    if (user.role === "admin" && users.filter((item) => item.role === "admin" && item.isActive).length === 1) {
      throw storeError("The last active administrator cannot be deleted.", 400);
    }
    users = users.filter((item) => item.id !== id);
    await persistUsers();
    return user;
  }

  async function listTechnicians({ includeInactive = true } = {}) {
    return technicians
      .filter((technician) => includeInactive || technician.isActive)
      .toSorted((a, b) => a.name.localeCompare(b.name));
  }

  async function createTechnician(input, actorUserId = "") {
    const validation = validateTechnicianInput(input);
    if (!validation.valid) throw storeError(validation.error, 400);
    const now = new Date().toISOString();
    const technician = { id: randomUUID(), ...validation.technician, createdBy: actorUserId, createdAt: now, updatedAt: now };
    technicians.push(technician);
    await persistTechnicians();
    return technician;
  }

  async function updateTechnician(id, updates) {
    const index = technicians.findIndex((technician) => technician.id === id);
    if (index < 0) throw storeError("Technician not found.", 404);
    const current = technicians[index];
    const validation = validateTechnicianInput({
      name: updates.name ?? current.name,
      email: updates.email ?? current.email,
      isActive: updates.isActive ?? current.isActive
    });
    if (!validation.valid) throw storeError(validation.error, 400);
    technicians[index] = { ...current, ...validation.technician, updatedAt: new Date().toISOString() };
    await persistTechnicians();
    return technicians[index];
  }

  async function deleteTechnician(id) {
    const isAssigned = tickets.some((ticket) => ticket.assignedTechnicianId === id && !ticket.deletedAt);
    if (isAssigned) return updateTechnician(id, { isActive: false });
    const technician = technicians.find((item) => item.id === id);
    if (!technician) throw storeError("Technician not found.", 404);
    technicians = technicians.filter((item) => item.id !== id);
    await persistTechnicians();
    return technician;
  }

  async function getDashboard(filters = {}) {
    const visibleTickets = filterTicketsByCreatedDateRange({
      tickets: await listTickets(),
      ...filters
    });
    return {
      tickets: visibleTickets,
      kpis: summarizeTicketKpis({ tickets: visibleTickets }),
      technicianKpis: summarizeTechnicianKpis({ tickets: visibleTickets, technicians }),
      technicians: await listTechnicians({ includeInactive: false }),
      filters: {
        dateFrom: filters.dateFrom || "",
        dateTo: filters.dateTo || ""
      }
    };
  }

  const persistTickets = () => writeJson(localPaths.tickets, tickets);
  const persistUsers = () => writeJson(localPaths.users, users);
  const persistTechnicians = () => writeJson(localPaths.technicians, technicians);
  const api = {
    initialize,
    listTickets,
    createTicket,
    updateTicket,
    deleteTicket,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    listTechnicians,
    createTechnician,
    updateTechnician,
    deleteTechnician,
    getDashboard
  };
  return api;
}

function createSupabaseHelpdeskStore(supabase) {
  async function initialize() {
    return api;
  }

  async function listTickets({ includeDeleted = false } = {}) {
    let query = supabase.from("tickets").select("*, technicians(name)").order("created_at", { ascending: false });
    if (!includeDeleted) query = query.is("deleted_at", null);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeTicketRow);
  }

  async function createTicket(input, options = {}) {
    const validation = validateTicketInput(input);
    if (!validation.valid) throw storeError(validation.error, 400);
    const prioritySlaHours = { Critical: 4, High: 8, Medium: 24, Low: 48 };
    const payload = {
      requester_user_id: options.requesterUserId || null,
      requester_name: validation.ticket.requesterName,
      requester_email: validation.ticket.email,
      department: validation.ticket.department,
      category: validation.ticket.category,
      priority: validation.ticket.priority,
      case_type: options.source === "admin" ? normalizeTicketCaseType(input.caseType) : "Minor",
      subject: validation.ticket.subject,
      description: validation.ticket.description,
      asset: validation.ticket.asset,
      location: validation.ticket.location,
      source: ["form", "ava", "admin"].includes(options.source) ? options.source : "form",
      created_by: options.actorUserId || options.requesterUserId || null,
      sla_hours: prioritySlaHours[validation.ticket.priority] || 24
    };
    const { data, error } = await supabase.from("tickets").insert(payload).select("*, technicians(name)").single();
    if (error) throw error;
    await addActivity(data, options.actorUserId, "created", { source: payload.source });
    return normalizeTicketRow(data);
  }

  async function updateTicket(id, updates, actorUserId = "") {
    const current = await findTicket(id);
    const normalized = updateHelpdeskTicket(normalizeTicketRow(current), updates);
    const payload = ticketUpdateRow(normalized);
    const { data, error } = await supabase
      .from("tickets")
      .update(payload)
      .eq("id", current.id)
      .select("*, technicians(name)")
      .single();
    if (error) throw error;
    await addActivity(data, actorUserId, "updated", updates);
    return normalizeTicketRow(data);
  }

  async function deleteTicket(id, actorUserId = "") {
    const current = await findTicket(id);
    const deletedAt = new Date().toISOString();
    const { data, error } = await supabase
      .from("tickets")
      .update({ deleted_at: deletedAt, deleted_by: actorUserId || null })
      .eq("id", current.id)
      .select("*, technicians(name)")
      .single();
    if (error) throw error;
    await addActivity(data, actorUserId, "deleted", {});
    return normalizeTicketRow(data);
  }

  async function listUsers() {
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: false });
    if (error) throw error;
    return (data || []).map(normalizeProfileRow);
  }

  async function createUser(input) {
    const validation = validateProfileInput(input);
    if (!validation.valid) throw storeError(validation.error, 400);
    if (!input.password) throw storeError("Enter a temporary password for this user.", 400);
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: validation.profile.email,
      password: input.password,
      email_confirm: true,
      user_metadata: {
        full_name: validation.profile.fullName,
        department: validation.profile.department
      }
    });
    if (authError) throw authError;
    const { data, error } = await supabase
      .from("profiles")
      .upsert(profileToRow({ id: authData.user.id, ...validation.profile, mustChangePassword: true }))
      .select()
      .single();
    if (error) throw error;
    return normalizeProfileRow(data);
  }

  async function updateUser(id, updates) {
    const payload = {};
    if (updates.fullName !== undefined) payload.full_name = updates.fullName;
    if (updates.department !== undefined) payload.department = updates.department;
    if (updates.role !== undefined) payload.role = updates.role;
    if (updates.approvalStatus !== undefined) {
      payload.approval_status = updates.approvalStatus;
      payload.approved_at = updates.approvalStatus === "approved" ? new Date().toISOString() : null;
    }
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;
    if (updates.mustChangePassword !== undefined) payload.must_change_password = updates.mustChangePassword;
    if (updates.approvedBy !== undefined) payload.approved_by = updates.approvedBy || null;
    const { data, error } = await supabase.from("profiles").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return normalizeProfileRow(data);
  }

  async function deleteUser(id) {
    const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", id).single();
    if (profileError) throw profileError;
    const { error } = await supabase.auth.admin.deleteUser(id);
    if (error) throw error;
    return normalizeProfileRow(profile);
  }

  async function listTechnicians({ includeInactive = true } = {}) {
    let query = supabase.from("technicians").select("*").order("name");
    if (!includeInactive) query = query.eq("is_active", true);
    const { data, error } = await query;
    if (error) throw error;
    return (data || []).map(normalizeTechnicianRow);
  }

  async function createTechnician(input, actorUserId = "") {
    const validation = validateTechnicianInput(input);
    if (!validation.valid) throw storeError(validation.error, 400);
    const { data, error } = await supabase
      .from("technicians")
      .insert({
        name: validation.technician.name,
        email: validation.technician.email,
        is_active: validation.technician.isActive,
        created_by: actorUserId || null
      })
      .select()
      .single();
    if (error) throw error;
    return normalizeTechnicianRow(data);
  }

  async function updateTechnician(id, updates) {
    const payload = {};
    if (updates.name !== undefined) payload.name = updates.name;
    if (updates.email !== undefined) payload.email = updates.email;
    if (updates.isActive !== undefined) payload.is_active = updates.isActive;
    const { data, error } = await supabase.from("technicians").update(payload).eq("id", id).select().single();
    if (error) throw error;
    return normalizeTechnicianRow(data);
  }

  async function deleteTechnician(id) {
    const { count } = await supabase
      .from("tickets")
      .select("id", { count: "exact", head: true })
      .eq("assigned_technician_id", id)
      .is("deleted_at", null);
    if (count) return updateTechnician(id, { isActive: false });
    const { data, error } = await supabase.from("technicians").delete().eq("id", id).select().single();
    if (error) throw error;
    return normalizeTechnicianRow(data);
  }

  async function getDashboard(filters = {}) {
    const [allTickets, technicians] = await Promise.all([
      listTickets(),
      listTechnicians({ includeInactive: true })
    ]);
    const tickets = filterTicketsByCreatedDateRange({ tickets: allTickets, ...filters });
    return {
      tickets,
      kpis: summarizeTicketKpis({ tickets }),
      technicianKpis: summarizeTechnicianKpis({ tickets, technicians }),
      technicians: technicians.filter((technician) => technician.isActive),
      filters: {
        dateFrom: filters.dateFrom || "",
        dateTo: filters.dateTo || ""
      }
    };
  }

  async function findTicket(id) {
    const number = ticketSequence(id);
    let query = supabase.from("tickets").select("*, technicians(name)");
    query = number ? query.eq("ticket_number", number) : query.eq("id", id);
    const { data, error } = await query.single();
    if (error || !data) throw storeError("Ticket not found.", 404);
    return data;
  }

  async function addActivity(ticket, actorUserId, action, details) {
    const { error } = await supabase.from("ticket_activity").insert({
      ticket_id: ticket.id,
      ticket_number: ticket.ticket_number,
      actor_user_id: actorUserId || null,
      action,
      details
    });
    if (error) throw error;
  }

  const api = {
    initialize,
    listTickets,
    createTicket,
    updateTicket,
    deleteTicket,
    listUsers,
    createUser,
    updateUser,
    deleteUser,
    listTechnicians,
    createTechnician,
    updateTechnician,
    deleteTechnician,
    getDashboard
  };
  return api;
}

function normalizeTicketRow(row) {
  return {
    recordId: row.id,
    id: formatTicketNumber(row.ticket_number),
    ticketNumber: row.ticket_number,
    requesterUserId: row.requester_user_id || "",
    requesterName: row.requester_name,
    email: row.requester_email,
    department: row.department || "",
    category: row.category,
    priority: row.priority,
    caseType: normalizeTicketCaseType(row.case_type),
    subject: row.subject,
    description: row.description,
    asset: row.asset || "",
    location: row.location || "",
    status: row.status,
    assignedTechnicianId: row.assigned_technician_id || "",
    assignedTo: row.technicians?.name || "",
    resolutionNote: row.resolution_note || "",
    source: row.source,
    slaHours: row.sla_hours,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at || "",
    deletedAt: row.deleted_at || "",
    deletedBy: row.deleted_by || ""
  };
}

function ticketUpdateRow(ticket) {
  return {
    requester_name: ticket.requesterName,
    requester_email: ticket.email,
    department: ticket.department,
    category: ticket.category,
    priority: ticket.priority,
    case_type: normalizeTicketCaseType(ticket.caseType),
    subject: ticket.subject,
    description: ticket.description,
    asset: ticket.asset,
    location: ticket.location,
    status: ticket.status,
    assigned_technician_id: ticket.assignedTechnicianId || null,
    resolution_note: ticket.resolutionNote,
    sla_hours: ticket.slaHours,
    closed_at: ticket.closedAt || null
  };
}

function normalizeProfileRow(row) {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    department: row.department || "",
    role: row.role,
    approvalStatus: row.approval_status,
    isActive: row.is_active,
    mustChangePassword: row.must_change_password,
    approvedBy: row.approved_by || "",
    approvedAt: row.approved_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function profileToRow(profile) {
  return {
    id: profile.id,
    email: profile.email,
    full_name: profile.fullName,
    department: profile.department,
    role: profile.role,
    approval_status: profile.approvalStatus,
    is_active: profile.isActive,
    must_change_password: Boolean(profile.mustChangePassword)
  };
}

function normalizeTechnicianRow(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email || "",
    isActive: row.is_active,
    createdBy: row.created_by || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function ticketSequence(id) {
  const value = Number(String(id || "").replace(/^HD-/, ""));
  return Number.isFinite(value) ? value : 0;
}

async function readJson(filePath, fallback) {
  if (!filePath) return structuredClone(fallback);
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return structuredClone(fallback);
  }
}

async function writeJson(filePath, value) {
  if (!filePath) return;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function storeError(message, status) {
  const error = new Error(message);
  error.status = status;
  return error;
}

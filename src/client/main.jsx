import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectionErrorMessage, getApiBaseUrl } from "./api-base.js";
import { AdminConsole } from "./admin-console.jsx";
import { AuthDialog, AuthProvider, useAuth } from "./auth.jsx";
import "./styles.css";

const API_BASE_URL = getApiBaseUrl();
const helpdeskRecipients = ["helpdesk_mis_north@ecoworld.my", "kokseng.lai@ecoworld.my"];

const defaultTicket = {
  requesterName: "",
  email: "",
  department: "",
  category: "Hardware",
  priority: "Medium",
  subject: "",
  description: "",
  asset: "",
  location: ""
};

const categories = ["Hardware", "Software", "Network", "Email", "Account Access", "Printer", "Security", "Other"];
const priorities = ["Critical", "High", "Medium", "Low"];

const seedTickets = [
  {
    id: "HD-1042",
    subject: "Laptop not turning on",
    requesterName: "John Doe",
    department: "Finance",
    priority: "Medium",
    status: "In Progress",
    createdAt: "2026-09-24T02:24:00.000Z",
    closedAt: "",
    slaHours: 24
  },
  {
    id: "HD-1041",
    subject: "Email not syncing",
    requesterName: "Sarah Lim",
    department: "Sales",
    priority: "High",
    status: "Open",
    createdAt: "2026-09-24T01:17:00.000Z",
    closedAt: "",
    slaHours: 8
  },
  {
    id: "HD-1040",
    subject: "Access to CRM",
    requesterName: "Michael Tan",
    department: "Marketing",
    priority: "Medium",
    status: "Waiting on User",
    createdAt: "2026-09-23T00:55:00.000Z",
    closedAt: "",
    slaHours: 24
  }
];

const api = {
  async health() {
    return request("/api/health");
  },
  async tickets() {
    return request("/api/dashboard");
  },
  async createTicket(ticket, token = "") {
    return request("/api/tickets", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify(ticket)
    });
  },
  async me(token) {
    return request("/api/me", { headers: authHeaders(token) });
  },
  async myTickets(token) {
    return request("/api/me/tickets", { headers: authHeaders(token) });
  },
  async registerProfile(token, profile) {
    return request("/api/auth/register-profile", { method: "POST", headers: authHeaders(token), body: JSON.stringify(profile) });
  },
  async completePasswordChange(token, passwords) {
    return request("/api/admin/change-password", { method: "POST", headers: authHeaders(token), body: JSON.stringify(passwords) });
  },
  async adminTickets(token) {
    return request("/api/admin/tickets", { headers: authHeaders(token) });
  },
  async adminCreateTicket(token, ticket) {
    return request("/api/admin/tickets", { method: "POST", headers: authHeaders(token), body: JSON.stringify(ticket) });
  },
  async adminUpdateTicket(token, id, updates) {
    return request(`/api/admin/tickets/${encodeURIComponent(id)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(updates) });
  },
  async adminDeleteTicket(token, id) {
    return request(`/api/admin/tickets/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(token) });
  },
  async session(sessionId) {
    return request(`/api/session/${sessionId}`);
  },
  async chat(sessionId, message) {
    return request("/api/chat", {
      method: "POST",
      body: JSON.stringify({ sessionId, message })
    });
  },
  async end(sessionId) {
    return request(`/api/session/${sessionId}/end`, { method: "POST" });
  },
  async contactHelpdesk(sessionId, contact) {
    return request(`/api/session/${sessionId}/contact`, {
      method: "POST",
      body: JSON.stringify(contact)
    });
  },
  async startTicketIntake(sessionId, token = "") {
    return request(`/api/session/${sessionId}/ticket/start`, { method: "POST", headers: authHeaders(token) });
  },
  async answerTicketIntake(sessionId, answer, token = "") {
    return request(`/api/session/${sessionId}/ticket/answer`, { method: "POST", headers: authHeaders(token), body: JSON.stringify({ answer }) });
  },
  async adminLogin(username, password) {
    return request("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({ username, password })
    });
  },
  async pdfs(token) {
    return request("/api/admin/pdfs", {
      headers: { Authorization: `Bearer ${token}` }
    });
  },
  async uploadPdfs(token, files) {
    const form = new FormData();
    [...files].forEach((file) => form.append("pdfs", file));
    return request("/api/admin/pdfs", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
  },
  async deletePdf(token, id) {
    return request(`/api/admin/pdfs/${encodeURIComponent(id)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` }
    });
  },
  async adminUsers(token) {
    return request("/api/admin/users", { headers: authHeaders(token) });
  },
  async adminCreateUser(token, user) {
    return request("/api/admin/users", { method: "POST", headers: authHeaders(token), body: JSON.stringify(user) });
  },
  async adminUpdateUser(token, id, user) {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(user) });
  },
  async adminApproveUser(token, id) {
    return request(`/api/admin/users/${encodeURIComponent(id)}/approve`, { method: "POST", headers: authHeaders(token) });
  },
  async adminRejectUser(token, id) {
    return request(`/api/admin/users/${encodeURIComponent(id)}/reject`, { method: "POST", headers: authHeaders(token) });
  },
  async adminDeleteUser(token, id) {
    return request(`/api/admin/users/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(token) });
  },
  async adminTechnicians(token) {
    return request("/api/admin/technicians", { headers: authHeaders(token) });
  },
  async adminCreateTechnician(token, technician) {
    return request("/api/admin/technicians", { method: "POST", headers: authHeaders(token), body: JSON.stringify(technician) });
  },
  async adminUpdateTechnician(token, id, technician) {
    return request(`/api/admin/technicians/${encodeURIComponent(id)}`, { method: "PATCH", headers: authHeaders(token), body: JSON.stringify(technician) });
  },
  async adminDeleteTechnician(token, id) {
    return request(`/api/admin/technicians/${encodeURIComponent(id)}`, { method: "DELETE", headers: authHeaders(token) });
  }
};

function authHeaders(token) {
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(url, options = {}) {
  const headers = options.body instanceof FormData ? options.headers : {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  let response;
  try {
    response = await fetch(`${API_BASE_URL}${url}`, { ...options, headers });
  } catch {
    throw new Error(connectionErrorMessage());
  }
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed");
    error.status = response.status;
    error.profile = payload.profile;
    throw error;
  }
  return payload;
}

function getSessionId() {
  const key = "ava-tab-session-id";
  let id = sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}

function App() {
  const auth = useAuth();
  const [route, setRoute] = useState(hashToRoute());
  const [ticketDraft, setTicketDraft] = useState(defaultTicket);
  const [ticketState, setTicketState] = useState({
    tickets: seedTickets,
    kpis: summarizeClientTickets(seedTickets),
    technicianKpis: [],
    technicians: [],
    loading: true
  });
  const [notice, setNotice] = useState("");
  const [authOpen, setAuthOpen] = useState(false);

  useEffect(() => {
    const onHash = () => setRoute(hashToRoute());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    refreshTickets();
  }, []);

  async function refreshTickets() {
    try {
      const data = await api.tickets();
      setTicketState({
        tickets: data.tickets || [],
        kpis: data.kpis || summarizeClientTickets(data.tickets || []),
        technicianKpis: data.technicianKpis || [],
        technicians: data.technicians || [],
        loading: false
      });
    } catch (error) {
      setNotice(error.message);
      setTicketState((current) => ({ ...current, loading: false }));
    }
  }

  function openTicketDraft(draft = {}) {
    setTicketDraft({ ...defaultTicket, ...draft });
    location.hash = "#submit";
  }

  async function createTicket(ticket) {
    const result = await api.createTicket(ticket, auth.token);
    mergeDashboard(result);
    setNotice(`${result.ticket.id} submitted. A Helpdesk email draft is ready for review.`);
    openTicketEmail(result.ticket);
    return result.ticket;
  }

  function mergeDashboard(data) {
    setTicketState((current) => ({
      tickets: data.tickets || data.dashboard?.tickets || current.tickets,
      kpis: data.kpis || data.dashboard?.kpis || current.kpis,
      technicianKpis: data.technicianKpis || data.dashboard?.technicianKpis || current.technicianKpis,
      technicians: data.technicians || data.dashboard?.technicians || current.technicians,
      loading: false
    }));
  }

  return (
    <div className="product-shell">
      <Header activeRoute={route} auth={auth} onOpenAuth={() => setAuthOpen(true)} />
      {notice ? <button className="global-notice" type="button" onClick={() => setNotice("")}>{notice}</button> : null}
      {route === "admin" ? (
        <AdminConsole api={api} auth={auth} dashboard={ticketState} onDashboard={mergeDashboard} />
      ) : route === "tickets" ? (
        <MyTickets auth={auth} onOpenAuth={() => setAuthOpen(true)} />
      ) : (
        <main className="workspace">
          <section className="submission-column" id="submit">
            <TicketSubmission initialTicket={ticketDraft} onSubmit={createTicket} onClearDraft={() => setTicketDraft(defaultTicket)} />
          </section>
          <section className="dashboard-column" id="dashboard">
            {route === "ava" ? (
              <ChatPage panelMode="full" auth={auth} onTicketCreated={(data) => { mergeDashboard(data); setNotice(`${data.ticket?.id || "Ticket"} created by Ava.`); }} />
            ) : (
              <Dashboard tickets={ticketState.tickets} kpis={ticketState.kpis} technicianKpis={ticketState.technicianKpis} loading={ticketState.loading} />
            )}
          </section>
          {route !== "ava" ? <ChatDock auth={auth} onTicketCreated={(data) => { mergeDashboard(data); setNotice(`${data.ticket?.id || "Ticket"} created by Ava.`); }} /> : null}
        </main>
      )}
      {authOpen ? <AuthDialog onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}

function hashToRoute() {
  const hash = location.hash.replace("#", "");
  return ["submit", "ava", "dashboard", "tickets", "admin"].includes(hash) ? hash : "dashboard";
}

function Header({ activeRoute, auth, onOpenAuth }) {
  const navItems = [
    ["submit", "Submit Ticket", "file"],
    ["ava", "Ask Ava", "chat"],
    ["dashboard", "MIS Dashboard", "chart"],
    ["tickets", "My Tickets", "user"],
    ["admin", "Admin", "gear"]
  ];

  return (
    <header className="app-header">
      <a className="brand" href="#dashboard" aria-label="Ava HelpDesk dashboard">
        <span className="brand-mark">A</span>
        <span>Ava HelpDesk</span>
      </a>
      <nav className="main-nav" aria-label="Main navigation">
        {navItems.map(([route, label, icon]) => (
          <a className={activeRoute === route ? "nav-link active" : "nav-link"} href={`#${route}`} key={route}>
            <Icon name={icon} />
            <span>{label}</span>
          </a>
        ))}
      </nav>
      <div className="header-tools">
        <div className="search-box">
          <Icon name="search" />
          <span>Search tickets, users, or assets...</span>
        </div>
        {auth.profile ? (
          <div className="account-tools">
            <span className="account-name">{auth.profile.fullName || auth.profile.email}</span>
            <button className="user-chip account-button" type="button" onClick={auth.signOut} title="Log out">{(auth.profile.fullName || auth.profile.email || "U").slice(0, 1).toUpperCase()}</button>
          </div>
        ) : (
          <button className="login-button" type="button" onClick={onOpenAuth}>Log in / Create account</button>
        )}
      </div>
    </header>
  );
}

function TicketSubmission({ initialTicket, onSubmit, onClearDraft }) {
  const [ticket, setTicket] = useState(initialTicket);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    setTicket(initialTicket);
  }, [initialTicket]);

  function update(field, value) {
    setTicket((current) => ({ ...current, [field]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const created = await onSubmit(ticket);
      setTicket(defaultTicket);
      onClearDraft();
      setNotice(`${created.id} has been created and sent to MIS Helpdesk.`);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  function clearForm() {
    setTicket(defaultTicket);
    onClearDraft();
    setNotice("");
  }

  return (
    <form className="ticket-form panel" onSubmit={submit}>
      <div className="section-title">
        <Icon name="file" />
        <div>
          <h1>Submit a Helpdesk Ticket</h1>
          <p>Use this simple structure for IT support requests. MIS can update status and close the ticket when solved.</p>
        </div>
      </div>
      <Field label="Requester Name" required icon="user">
        <input value={ticket.requesterName} onChange={(event) => update("requesterName", event.target.value)} placeholder="Your name" required />
      </Field>
      <Field label="Email" required icon="mail">
        <input value={ticket.email} onChange={(event) => update("email", event.target.value)} type="email" placeholder="name@company.com" required />
      </Field>
      <div className="form-grid">
        <Field label="Department" icon="building">
          <input value={ticket.department} onChange={(event) => update("department", event.target.value)} placeholder="Finance" />
        </Field>
        <Field label="Category" required>
          <select value={ticket.category} onChange={(event) => update("category", event.target.value)} required>
            {categories.map((category) => <option key={category}>{category}</option>)}
          </select>
        </Field>
        <Field label="Priority" required>
          <select value={ticket.priority} onChange={(event) => update("priority", event.target.value)} required>
            {priorities.map((priority) => <option key={priority}>{priority}</option>)}
          </select>
        </Field>
        <Field label="Asset / Device" icon="laptop">
          <input value={ticket.asset} onChange={(event) => update("asset", event.target.value)} placeholder="Laptop, printer, phone" />
        </Field>
      </div>
      <Field label="Subject" required icon="subject">
        <input value={ticket.subject} onChange={(event) => update("subject", event.target.value)} placeholder="Short problem title" required />
      </Field>
      <Field label="Location" icon="pin">
        <input value={ticket.location} onChange={(event) => update("location", event.target.value)} placeholder="Office, floor, branch" />
      </Field>
      <Field label="Description" required>
        <textarea
          value={ticket.description}
          onChange={(event) => update("description", event.target.value)}
          placeholder="Describe the issue, error message, device name, and what you already tried."
          rows="5"
          required
        />
      </Field>
      <div className="attachment-drop">
        <Icon name="paperclip" />
        <span>Attachment placeholder: PDF, JPG, PNG, ZIP up to 10 MB</span>
      </div>
      {notice ? <p className="notice compact">{notice}</p> : null}
      <div className="form-actions">
        <button className="secondary-button pressable" type="button" onClick={clearForm}>
          <Icon name="reset" />
          Clear Form
        </button>
        <button className="primary-button pressable" type="submit" disabled={busy}>
          <Icon name="send" />
          {busy ? "Submitting..." : "Submit Ticket"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, required = false, icon, children }) {
  return (
    <label className="field">
      <span>{icon ? <Icon name={icon} /> : null}{label}{required ? <em>*</em> : null}</span>
      {children}
    </label>
  );
}

function MyTickets({ auth, onOpenAuth }) {
  const [tickets, setTickets] = useState([]);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!auth.token || auth.approvalStatus !== "approved") return;
    api.myTickets(auth.token)
      .then((data) => setTickets(data.tickets || []))
      .catch((error) => setNotice(error.message));
  }, [auth.approvalStatus, auth.token]);

  if (!auth.profile) {
    return <main className="account-page"><section className="account-empty panel"><Icon name="user" /><h1>My Tickets</h1><p>Log in to see requests linked to your account. Guest ticket submission remains available without an account.</p><button className="primary-button" type="button" onClick={onOpenAuth}>Log in or create account</button></section></main>;
  }
  if (auth.approvalStatus !== "approved") {
    return <main className="account-page"><section className="account-empty panel"><Icon name="clock" /><h1>Approval {auth.approvalStatus || "pending"}</h1><p>Your account is waiting for MIS administrator approval. You may continue to submit tickets as a guest.</p><a className="primary-button link-button" href="#submit">Submit guest ticket</a></section></main>;
  }
  return <main className="account-page"><section className="dashboard panel"><div className="section-title"><Icon name="user" /><div><h1>My Tickets</h1><p>Requests created while signed in to {auth.profile.email}.</p></div></div>{notice ? <p className="notice compact">{notice}</p> : null}<TicketTable tickets={tickets} manageLink={false} /></section></main>;
}

function Dashboard({ tickets, kpis, technicianKpis = [], loading }) {
  const recent = tickets.length ? tickets.slice(0, 7) : loading ? seedTickets : [];
  const priorityData = kpis?.byPriority || summarizeClientTickets(recent).byPriority;
  const statusData = kpis?.byStatus || summarizeClientTickets(recent).byStatus;
  const openTickets = kpis?.openTickets ?? 0;
  const closedToday = kpis?.closedToday ?? 0;
  const avgResolution = kpis?.averageResolutionHours ?? 0;
  const slaMet = kpis?.slaMetPercent ?? 100;

  return (
    <div className="dashboard panel">
      <div className="dashboard-heading">
        <div className="section-title">
          <Icon name="chart" />
          <div>
            <h2>MIS Helpdesk Overview</h2>
            <p>Live ticket status and KPI monitoring for support performance.</p>
          </div>
        </div>
        <div className="period-control">
          <Icon name="calendar" />
          <span>This Week</span>
        </div>
      </div>
      {loading ? <p className="notice compact">Loading ticket KPI data...</p> : null}
      <div className="kpi-grid">
        <KpiCard title="Open Tickets" value={openTickets} trend="+12%" icon="file" tone="blue" />
        <KpiCard title="Closed Today" value={closedToday} trend="+42%" icon="check" tone="green" />
        <KpiCard title="Avg Resolution" value={`${avgResolution}h`} trend="-28%" icon="clock" tone="cyan" />
        <KpiCard title="SLA Met" value={`${slaMet}%`} trend="+3%" icon="shield" tone="green" />
      </div>
      <div className="analytics-grid">
        <PriorityChart data={priorityData} total={openTickets || Object.values(priorityData).reduce((sum, value) => sum + value, 0)} />
        <StatusBars data={statusData} />
      </div>
      <TechnicianProgress rows={technicianKpis} />
      <TicketTable tickets={recent} />
    </div>
  );
}

function TechnicianProgress({ rows }) {
  return (
    <article className="technician-progress">
      <div className="table-title"><div><h3>Technician Progress</h3><p>Current workload by support technician.</p></div><a href="#admin">Manage team</a></div>
      <div className="tech-head"><span>Technician</span><span>Open</span><span>In Progress</span><span>Closed</span><span>Total</span></div>
      {rows.map((row) => <div className="tech-row" key={row.id || row.name}><span><strong>{row.name}</strong></span><span>{row.open || 0}</span><span>{row.inProgress || 0}</span><span>{row.closed || 0}</span><span>{row.total || 0}</span></div>)}
      {!rows.length ? <p className="notice compact">Add IT support technicians in Admin to begin tracking team progress.</p> : null}
    </article>
  );
}

function KpiCard({ title, value, trend, icon, tone }) {
  return (
    <article className={`kpi-card ${tone}`}>
      <span className="kpi-icon"><Icon name={icon} /></span>
      <div>
        <p>{title}</p>
        <strong>{value}</strong>
        <small>{trend} vs. last week</small>
      </div>
    </article>
  );
}

function PriorityChart({ data, total }) {
  const entries = Object.entries(data);
  const critical = data.Critical || 0;
  const high = data.High || 0;
  const medium = data.Medium || 0;
  const low = data.Low || 0;
  const displayTotal = total || critical + high + medium + low;
  const safeTotal = displayTotal || 1;
  const gradient = displayTotal
    ? `conic-gradient(#ef4444 0 ${critical / safeTotal}turn, #f97316 ${critical / safeTotal}turn ${(critical + high) / safeTotal}turn, #fbbf24 ${(critical + high) / safeTotal}turn ${(critical + high + medium) / safeTotal}turn, #22c55e ${(critical + high + medium) / safeTotal}turn 1turn)`
    : "#e5edf3";

  return (
    <article className="chart-card">
      <h3>Tickets by Priority</h3>
      <div className="priority-chart">
        <div className="donut" style={{ background: gradient }}>
          <span>{displayTotal}</span>
          <small>Total</small>
        </div>
        <div className="legend">
          {entries.map(([label, value]) => (
            <span key={label}><i className={`dot ${label.toLowerCase()}`} />{label}<strong>{value}</strong></span>
          ))}
        </div>
      </div>
    </article>
  );
}

function StatusBars({ data }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <article className="chart-card">
      <h3>Support Status</h3>
      <div className="bars">
        {Object.entries(data).slice(0, 6).map(([label, value]) => (
          <div className="bar-item" key={label}>
            <strong>{value}</strong>
            <span style={{ height: `${Math.max(8, (value / max) * 130)}px` }} />
            <small>{label}</small>
          </div>
        ))}
      </div>
    </article>
  );
}

function TicketTable({ tickets, manageLink = true }) {
  return (
    <article className="ticket-table">
      <div className="table-title">
        <h3>Recent Tickets</h3>
        {manageLink ? <a href="#admin">Manage Tickets</a> : null}
      </div>
      <div className="table-head">
        <span>#</span><span>Subject</span><span>Requester</span><span>Department</span><span>Priority</span><span>Status</span><span>Created</span>
      </div>
      {tickets.map((ticket) => (
        <div className="table-row" key={ticket.id}>
          <span className="ticket-id">{ticket.id}</span>
          <span>{ticket.subject}</span>
          <span>{ticket.requesterName || "Private"}</span>
          <span>{ticket.department || "-"}</span>
          <span><i className={`dot ${String(ticket.priority).toLowerCase()}`} />{ticket.priority}</span>
          <span className={`status-pill ${slug(ticket.status)}`}>{ticket.status}</span>
          <span>{formatDate(ticket.createdAt)}</span>
        </div>
      ))}
      {!tickets.length ? <p className="notice compact">No submitted tickets yet.</p> : null}
    </article>
  );
}

function ChatDock({ auth, onTicketCreated }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button className="chat-fab pressable" type="button" onClick={() => setOpen(true)} aria-label="Open Ava chatbot">
        <RobotIcon small />
        <span>Ask Ava</span>
      </button>
    );
  }
  return (
    <aside className="chat-dock">
      <div className="chat-dock-header">
        <RobotIcon small />
        <div>
          <strong>Ask Ava</strong>
          <span>Online</span>
        </div>
        <button type="button" onClick={() => setOpen(false)} aria-label="Minimize Ava chat">-</button>
      </div>
      <ChatPage panelMode="dock" auth={auth} onTicketCreated={onTicketCreated} />
    </aside>
  );
}

function ChatPage({ panelMode = "full", auth, onTicketCreated }) {
  const sessionId = useMemo(getSessionId, []);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I’m Ava, your IT Helpdesk assistant. May I know your name?",
      timestamp: new Date().toISOString(),
      source: "system"
    }
  ]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [contactOpen, setContactOpen] = useState(false);
  const [intakeActive, setIntakeActive] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    api.session(sessionId).then((data) => {
      if (data.messages?.length) setMessages(data.messages);
    }).catch((error) => setNotice(error.message));
  }, [sessionId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function sendMessage(event) {
    event.preventDefault();
    const text = message.trim();
    if (!text || busy) return;
    setMessage("");
    setBusy(true);
    setNotice("");
    setMessages((current) => [...current, { role: "user", content: text, timestamp: new Date().toISOString() }]);
    try {
      const response = intakeActive
        ? await api.answerTicketIntake(sessionId, text, auth?.token)
        : await api.chat(sessionId, text);
      setMessages((current) => [...current.filter((item) => item.content !== text || item.role !== "user"), ...response.messages]);
      setIntakeActive(Boolean(response.intakeActive));
      if (response.ticketCreated) onTicketCreated?.(response.dashboard ? { ...response.dashboard, ticket: response.ticket } : response);
      if (response.contactRequested) setContactOpen(true);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function endConversation() {
    setBusy(true);
    try {
      const result = await api.end(sessionId);
      setMessages([
        {
          role: "assistant",
          content: `Conversation ended and ${result.archivedMessages} messages were recorded in helpdesklog. I cleared this tab’s memory.`,
          timestamp: new Date().toISOString(),
          source: "system"
        }
      ]);
      sessionStorage.removeItem("ava-tab-session-id");
      setNotice("This conversation was saved and memory was cleared.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function contactHelpdesk(contact) {
    setBusy(true);
    setNotice("");
    try {
      const result = await api.contactHelpdesk(sessionId, contact);
      if (result.transcriptNeedsAttachment) {
        downloadTranscript(result.transcriptFileName, result.transcript);
      }
      setContactOpen(false);
      setMessages([
        {
          role: "assistant",
          content: result.transcriptNeedsAttachment
            ? "Your Helpdesk email draft is ready. Please attach the downloaded conversation transcript before sending it."
            : "Your Helpdesk email draft is ready. Please review it and press Send in your email application.",
          timestamp: new Date().toISOString(),
          source: "system"
        }
      ]);
      sessionStorage.removeItem("ava-tab-session-id");
      setNotice("The conversation was archived and this tab’s memory was cleared.");
      window.location.href = result.mailtoUrl;
    } catch (error) {
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function startTicketIntake() {
    setBusy(true);
    setNotice("");
    try {
      const response = await api.startTicketIntake(sessionId, auth?.token);
      setIntakeActive(true);
      setMessages((current) => [...current, ...response.messages]);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  const capturedName = messages.findLast?.((item) => item.profileName)?.profileName || "";

  return (
    <section className={panelMode === "dock" ? "chat-panel dock-mode" : "chat-panel full-mode"}>
      {panelMode === "full" ? (
        <div className="section-title chat-page-title">
          <RobotIcon small />
          <div>
            <h1>Ask Ava</h1>
            <p>Ava checks local uploaded PDF files first, then uses the OpenAI fallback only for IT support questions.</p>
          </div>
        </div>
      ) : null}
      <div className="messages" ref={scrollRef}>
        {messages.map((item, index) => (
          <Message key={`${item.timestamp}-${index}`} message={item} />
        ))}
        {busy && <div className="typing">Ava is thinking...</div>}
      </div>
      {notice && <p className="notice compact">{notice}</p>}
      <div className="chat-actions">
        <button className="secondary-button pressable" type="button" onClick={() => setContactOpen(true)} disabled={busy}>Email Helpdesk</button>
        <button className={intakeActive ? "primary-button pressable" : "secondary-button pressable"} type="button" onClick={startTicketIntake} disabled={busy || intakeActive}>{intakeActive ? "Creating Ticket..." : "Create Ticket"}</button>
        {panelMode === "full" ? <button className="secondary-button pressable" type="button" onClick={endConversation} disabled={busy}>End Chat</button> : null}
      </div>
      <form className="composer" onSubmit={sendMessage}>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Type your IT support question..."
          rows="2"
        />
        <button className="icon-button pressable" type="submit" disabled={busy} aria-label="Send message">
          <Icon name="send" />
        </button>
      </form>
      {contactOpen ? (
        <ContactHelpdeskDialog
          defaultName={capturedName}
          busy={busy}
          onClose={() => setContactOpen(false)}
          onSubmit={contactHelpdesk}
        />
      ) : null}
    </section>
  );
}

function ContactHelpdeskDialog({ defaultName, busy, onClose, onSubmit }) {
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setError("");
    try {
      await onSubmit({ name, email });
    } catch (submitError) {
      setError(submitError.message);
    }
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-title">
        <h2 id="contact-title">Email Helpdesk</h2>
        <p>Ava will summarize and archive this conversation, then open a prepared email for review.</p>
        <form onSubmit={submit}>
          <Field label="Name" required>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
          </Field>
          <Field label="Email" required>
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
          </Field>
          {error ? <p className="form-error">{error}</p> : null}
          <div className="dialog-actions">
            <button className="secondary-button pressable" type="button" onClick={onClose} disabled={busy}>Cancel</button>
            <button className="primary-button pressable" type="submit" disabled={busy}>
              {busy ? "Preparing..." : "Prepare Email"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}

function AdminPage({ tickets, onTicketUpdate }) {
  const [username, setUsername] = useState("Admin");
  const [password, setPassword] = useState("");
  const [token, setToken] = useState("");
  const [files, setFiles] = useState([]);
  const [selected, setSelected] = useState([]);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!token) return;
    api.pdfs(token).then((data) => setFiles(data.files || [])).catch(() => {
      setToken("");
    });
  }, [token]);

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    try {
      const response = await api.adminLogin(username, password);
      setToken(response.token);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(event) {
    event.preventDefault();
    if (!selected.length) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await api.uploadPdfs(token, selected);
      setFiles(response.files || []);
      setSelected([]);
      setNotice("PDF library updated and chunked into Ava's searchable knowledge base.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function deletePdf(file) {
    if (!window.confirm(`Remove ${file.originalName} from Ava's PDF library?`)) return;
    setBusy(true);
    setNotice("");
    try {
      const response = await api.deletePdf(token, file.id);
      setFiles(response.files || []);
      setNotice("PDF removed from Ava's library.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  async function changeTicketStatus(ticket, status) {
    setBusy(true);
    setNotice("");
    try {
      await onTicketUpdate(token, ticket.id, { status, assignedTo: "MIS Support" });
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-workspace">
      <section className="admin-card panel">
        <div className="admin-heading">
          <div className="section-title">
            <Icon name="gear" />
            <div>
              <h1>Admin Console</h1>
              <p>Manage Ava's PDF library and close support tickets after resolution.</p>
            </div>
          </div>
          {token ? <button className="secondary-button pressable" type="button" onClick={() => setToken("")}>Log out</button> : null}
        </div>
        {!token ? (
          <form className="login-form" onSubmit={login}>
            <Field label="Admin username">
              <input value={username} onChange={(event) => setUsername(event.target.value)} type="text" placeholder="Admin" autoComplete="username" />
            </Field>
            <Field label="Admin password">
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="Enter password" autoComplete="current-password" />
            </Field>
            <button className="primary-button pressable" type="submit" disabled={busy}>Log in</button>
          </form>
        ) : (
          <>
            <div className="admin-grid">
              <form className="upload-box" onSubmit={upload}>
                <input
                  id="pdfs"
                  type="file"
                  multiple
                  accept="application/pdf,.pdf"
                  onChange={(event) => setSelected(event.target.files)}
                />
                <label htmlFor="pdfs">
                  <Icon name="paperclip" />
                  <strong>Upload PDF Knowledge Files</strong>
                  <span>{selected.length ? `${selected.length} selected` : "Click to browse up to 50 PDF files"}</span>
                </label>
                <button className="primary-button pressable" disabled={busy || !selected.length} type="submit">Upload PDFs</button>
              </form>
              <div className="schema-box">
                <h3>Simple Ticket Data Structure</h3>
                <ul>
                  <li>Requester: name, email, department</li>
                  <li>Issue: category, priority, subject, description</li>
                  <li>Asset: device, location, optional attachment reference</li>
                  <li>Lifecycle: ticket id, status, assigned staff, SLA hours, created, updated, closed</li>
                  <li>Resolution: close status and support note</li>
                </ul>
              </div>
            </div>
            <div className="library-table">
              <div className="library-head">
                <span>File Name</span><span>Size</span><span>Pages</span><span>Status</span><span>Action</span>
              </div>
              {files.map((file) => (
                <div className="library-row" key={file.id}>
                  <span>{file.originalName}</span>
                  <span>{formatBytes(file.size)}</span>
                  <span>{file.pages || "-"}</span>
                  <span className="indexed">Indexed</span>
                  <button className="danger-button pressable" type="button" onClick={() => deletePdf(file)} disabled={busy}>Delete PDF</button>
                </div>
              ))}
              {!files.length && <p className="notice compact">No PDFs uploaded yet.</p>}
            </div>
            <AdminTicketBoard tickets={tickets} busy={busy} onStatusChange={changeTicketStatus} />
          </>
        )}
        {notice && <p className="notice compact">{notice}</p>}
      </section>
    </main>
  );
}

function AdminTicketBoard({ tickets, busy, onStatusChange }) {
  return (
    <section className="admin-ticket-board">
      <h2>Support Ticket Queue</h2>
      <div className="admin-ticket-list">
        {tickets.map((ticket) => (
          <article className="ticket-management-row" key={ticket.id}>
            <div>
              <strong>{ticket.id} · {ticket.subject}</strong>
              <span>{ticket.requesterName} · {ticket.email} · {ticket.priority}</span>
            </div>
            <select value={ticket.status} onChange={(event) => onStatusChange(ticket, event.target.value)} disabled={busy}>
              {ticketStatuses.map((status) => <option key={status}>{status}</option>)}
            </select>
          </article>
        ))}
        {!tickets.length ? <p className="notice compact">No tickets submitted yet.</p> : null}
      </div>
    </section>
  );
}

function Message({ message }) {
  const isUser = message.role === "user";
  const sourceLabel = {
    openai: "OpenAI",
    openai_error: "AI unavailable",
    out_of_scope: "IT support only",
    needs_clarification: "More detail needed",
    helpdesk_escalation: "Contact IT",
    helpdesk_offer: "Contact IT",
    helpdesk_contact: "Contact IT",
    ticket_intake: "Ticket intake",
    ticket_created: "Ticket created"
  }[message.source] || "Setup needed";
  const showSource = message.source && !["system", "local_pdf"].includes(message.source);

  return (
    <article className={isUser ? "message user" : "message ava"}>
      {!isUser && <RobotIcon small />}
      <div>
        <p>{message.content}</p>
        <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        {showSource && <span className="source-tag">{sourceLabel}</span>}
      </div>
    </article>
  );
}

function RobotIcon({ small = false }) {
  return (
    <svg className={small ? "ava-icon ava-icon-small" : "ava-icon"} viewBox="0 0 64 64" role="img" aria-label="Ava assistant icon">
      <rect className="ava-icon-shadow" x="12" y="20" width="40" height="34" rx="13" />
      <path className="ava-icon-antenna" d="M32 20V9" />
      <circle className="ava-icon-node" cx="32" cy="8" r="5" />
      <rect className="ava-icon-face" x="10" y="18" width="44" height="34" rx="13" />
      <circle className="ava-icon-eye" cx="24" cy="34" r="4" />
      <circle className="ava-icon-eye" cx="40" cy="34" r="4" />
      <path className="ava-icon-mouth" d="M25 43c4 3 10 3 14 0" />
      <path className="ava-icon-ear" d="M10 31H6v9h4" />
      <path className="ava-icon-ear" d="M54 31h4v9h-4" />
    </svg>
  );
}

function Icon({ name }) {
  const paths = {
    file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /><path d="M10 13h6M10 17h6" /></>,
    chat: <><path d="M4 5h16v11H8l-4 4z" /></>,
    chart: <><path d="M5 19V9M12 19V5M19 19v-7" /><path d="M3 21h18" /></>,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a8 8 0 0 0-1.8-1L14.4 3h-4.8l-.4 3.1a8 8 0 0 0-1.8 1L5 6.1l-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a8 8 0 0 0 1.8 1l.4 3.1h4.8l.4-3.1a8 8 0 0 0 1.8-1l2.4 1 2-3.4-2-1.5c.1-.3.1-.7.1-1z" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m16 16 4 4" /></>,
    user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
    mail: <><path d="M4 6h16v12H4z" /><path d="m4 7 8 6 8-6" /></>,
    building: <><path d="M5 21V4h10v17M15 9h4v12" /><path d="M8 8h3M8 12h3M8 16h3" /></>,
    laptop: <><path d="M5 6h14v10H5z" /><path d="M3 20h18" /></>,
    subject: <><path d="M7 4h10l3 3v13H7z" /><path d="M10 13h8M10 17h8" /></>,
    pin: <><path d="M12 22s7-6.1 7-12a7 7 0 0 0-14 0c0 5.9 7 12 7 12z" /><circle cx="12" cy="10" r="2" /></>,
    paperclip: <><path d="M21 12.5 12 21a6 6 0 0 1-8.5-8.5l9.5-9a4 4 0 1 1 5.5 5.8L9 18a2 2 0 0 1-2.8-2.8l8.8-8.2" /></>,
    reset: <><path d="M4 12a8 8 0 1 0 2.3-5.7L4 8" /><path d="M4 4v4h4" /></>,
    send: <><path d="M22 2 11 13" /><path d="m22 2-7 20-4-9-9-4z" /></>,
    check: <><path d="m5 12 4 4L19 6" /></>,
    clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    shield: <><path d="M12 3 5 6v5c0 5 3 9 7 10 4-1 7-5 7-10V6z" /><path d="m9 12 2 2 4-5" /></>,
    calendar: <><path d="M5 5h14v15H5z" /><path d="M8 3v4M16 3v4M5 10h14" /></>
  };
  return (
    <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true">
      {paths[name] || paths.file}
    </svg>
  );
}

function downloadTranscript(fileName, transcript) {
  const url = URL.createObjectURL(new Blob([transcript], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

function openTicketEmail(ticket) {
  const subject = `Helpdesk Ticket ${ticket.id} - ${ticket.subject}`;
  const body = [
    `Ticket: ${ticket.id}`,
    `Requester: ${ticket.requesterName}`,
    `Email: ${ticket.email}`,
    `Department: ${ticket.department || "-"}`,
    `Category: ${ticket.category}`,
    `Priority: ${ticket.priority}`,
    `Asset / Device: ${ticket.asset || "-"}`,
    `Location: ${ticket.location || "-"}`,
    "",
    "Problem description:",
    ticket.description
  ].join("\n");
  window.location.href = `mailto:${helpdeskRecipients.map(encodeURIComponent).join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function summarizeClientTickets(tickets = []) {
  const byPriority = { Critical: 0, High: 0, Medium: 0, Low: 0 };
  const byStatus = { Open: 0, "In Progress": 0, "Waiting on User": 0, "On Hold": 0, Resolved: 0, Closed: 0 };
  for (const ticket of tickets) {
    if (byPriority[ticket.priority] !== undefined) byPriority[ticket.priority] += 1;
    if (byStatus[ticket.status] !== undefined) byStatus[ticket.status] += 1;
  }
  return {
    totalTickets: tickets.length,
    openTickets: tickets.filter((ticket) => !["Resolved", "Closed"].includes(ticket.status)).length,
    closedToday: tickets.filter((ticket) => ticket.closedAt).length,
    averageResolutionHours: 0,
    slaMetPercent: 100,
    byPriority,
    byStatus
  };
}

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const rootContainer = document.getElementById("root");
const root = rootContainer.__avaRoot || createRoot(rootContainer);
rootContainer.__avaRoot = root;
root.render(
  <AuthProvider api={api}>
    <App />
  </AuthProvider>
);

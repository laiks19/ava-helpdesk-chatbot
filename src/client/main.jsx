import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  buildAdminDashboardPath,
  clearChatSessionId,
  connectionErrorMessage,
  endChatBeforeSignOut,
  getApiBaseUrl,
  getChatSessionId
} from "./api-base.js";
import { AdminConsole } from "./admin-console.jsx";
import { AiNews } from "./ai-news.jsx";
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

const api = {
  async health() {
    return request("/api/health");
  },
  async aiNews() {
    return request("/api/ai-news");
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
  async adminDashboard(token, filters = {}) {
    return request(buildAdminDashboardPath(filters), { headers: authHeaders(token) });
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
  async heartbeat(sessionId) {
    return request(`/api/session/${sessionId}/heartbeat`, { method: "POST" });
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

function App() {
  const auth = useAuth();
  const [chatSessionVersion, setChatSessionVersion] = useState(0);
  const sessionId = useMemo(getChatSessionId, [chatSessionVersion]);
  const [route, setRoute] = useState(hashToRoute());
  const [ticketDraft, setTicketDraft] = useState(defaultTicket);
  const [ticketHistory, setTicketHistory] = useState([]);
  const [ticketHistoryLoading, setTicketHistoryLoading] = useState(false);
  const [ticketHistoryNotice, setTicketHistoryNotice] = useState("");
  const [notice, setNotice] = useState("");
  const [authOpen, setAuthOpen] = useState(false);
  const isApprovedUser = Boolean(
    auth.token &&
    auth.profile?.approvalStatus === "approved" &&
    auth.profile?.isActive === true
  );

  useEffect(() => {
    const onHash = () => setRoute(hashToRoute());
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  useEffect(() => {
    if (!isApprovedUser) {
      setTicketHistory([]);
      setTicketHistoryNotice("");
      return undefined;
    }
    let active = true;
    setTicketHistoryLoading(true);
    setTicketHistoryNotice("");
    api.myTickets(auth.token)
      .then((data) => {
        if (active) setTicketHistory(data.tickets || []);
      })
      .catch((error) => {
        if (active) setTicketHistoryNotice(error.message);
      })
      .finally(() => {
        if (active) setTicketHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [auth.token, isApprovedUser]);

  useEffect(() => {
    const heartbeat = () => api.heartbeat(sessionId).catch(() => {});
    heartbeat();
    const timer = window.setInterval(heartbeat, 30_000);
    return () => window.clearInterval(timer);
  }, [sessionId]);

  function renewChatSession(message = "") {
    clearChatSessionId();
    setChatSessionVersion((current) => current + 1);
    if (message) setNotice(message);
  }

  async function signOut() {
    try {
      await endChatBeforeSignOut({
        endSession: api.end,
        signOut: auth.signOut
      });
    } finally {
      setChatSessionVersion((current) => current + 1);
    }
  }

  const appAuth = { ...auth, signOut };

  function openTicketDraft(draft = {}) {
    setTicketDraft({ ...defaultTicket, ...draft });
    location.hash = "#submit";
  }

  async function createTicket(ticket) {
    const result = await api.createTicket(ticket, auth.token);
    openTicketEmail(result.ticket);
    return result.ticket;
  }

  function addTicketToHistory(created) {
    if (!isApprovedUser) return;
    setTicketHistory((current) => [created, ...current.filter((ticket) => ticket.id !== created.id)]);
  }

  function handleAvaTicketCreated(data) {
    if (data.ticket) addTicketToHistory(data.ticket);
    setNotice(`${data.ticket?.id || "Ticket"} created by Ava.`);
  }

  return (
    <div className="product-shell">
      <Header activeRoute={route} auth={appAuth} onOpenAuth={() => setAuthOpen(true)} />
      {notice ? <button className="global-notice" type="button" onClick={() => setNotice("")}>{notice}</button> : null}
      {route === "admin" ? (
        <AdminConsole api={api} auth={appAuth} />
      ) : route === "tickets" ? (
        <MyTickets auth={auth} onOpenAuth={() => setAuthOpen(true)} />
      ) : (
        <>
          <main className={`workspace public-workspace submission-workspace${isApprovedUser ? " signed-in" : ""}`}>
            <section className="submission-column" id="submit">
              <TicketSubmission
                initialTicket={ticketDraft}
                onSubmit={createTicket}
                onCreated={addTicketToHistory}
                onClearDraft={() => setTicketDraft(defaultTicket)}
                requiresConfirmation={!isApprovedUser}
              />
            </section>
            {isApprovedUser ? (
              <SubmissionHistory
                tickets={ticketHistory}
                loading={ticketHistoryLoading}
                notice={ticketHistoryNotice}
              />
            ) : null}
            <section className="assistant-column" id="ava">
              <ChatPage
                key={sessionId}
                panelMode="full"
                auth={auth}
                sessionId={sessionId}
                onSessionEnded={renewChatSession}
                onTicketCreated={handleAvaTicketCreated}
              />
            </section>
          </main>
          <AiNews api={api} />
        </>
      )}
      {authOpen ? <AuthDialog onClose={() => setAuthOpen(false)} /> : null}
    </div>
  );
}

function hashToRoute() {
  const hash = location.hash.replace("#", "");
  if (["dashboard", "ava"].includes(hash)) return "submit";
  return ["submit", "tickets", "admin"].includes(hash) ? hash : "submit";
}

function Header({ activeRoute, auth, onOpenAuth }) {
  const navItems = [
    ["submit", "Submit Ticket", "file"],
    ...(auth.profile?.approvalStatus === "approved" && auth.profile?.isActive === true ? [["tickets", "My Tickets", "user"]] : []),
    ...(auth.profile?.role === "admin" && auth.profile?.approvalStatus === "approved" && auth.profile?.isActive === true ? [["admin", "Admin Console", "gear"]] : [])
  ];

  return (
    <header className="app-header">
      <a className="brand" href="#submit" aria-label="Ava HelpDesk home">
        <img className="brand-mark" src="/ava-helpdesk-logo.png" alt="Ava HelpDesk" />
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

function TicketSubmission({ initialTicket, onSubmit, onCreated, onClearDraft, requiresConfirmation = false }) {
  const [ticket, setTicket] = useState(initialTicket);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [dialog, setDialog] = useState(null);

  useEffect(() => {
    setTicket(initialTicket);
  }, [initialTicket]);

  function update(field, value) {
    setTicket((current) => ({ ...current, [field]: value }));
  }

  async function createTicket() {
    setBusy(true);
    setNotice("");
    try {
      const created = await onSubmit(ticket);
      setTicket(defaultTicket);
      onClearDraft();
      onCreated?.(created);
      if (requiresConfirmation) {
        setDialog({ stage: "success", ticket: created });
      } else {
        setNotice(`${created.id} has been created and sent to MIS Helpdesk.`);
      }
    } catch (error) {
      if (requiresConfirmation) {
        setDialog({ stage: "review", error: error.message });
      } else {
        setNotice(error.message);
      }
    } finally {
      setBusy(false);
    }
  }

  function submit(event) {
    event.preventDefault();
    setNotice("");
    if (requiresConfirmation) {
      setDialog({ stage: "review" });
      return;
    }
    createTicket();
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
      {dialog ? (
        <TicketConfirmationDialog
          stage={dialog.stage}
          ticket={dialog.ticket || ticket}
          error={dialog.error}
          busy={busy}
          onBack={() => setDialog(null)}
          onConfirm={createTicket}
          onClose={() => setDialog(null)}
        />
      ) : null}
    </form>
  );
}

function TicketConfirmationDialog({ stage, ticket, error, busy, onBack, onConfirm, onClose }) {
  if (stage === "success") {
    return (
      <div className="dialog-backdrop" role="presentation">
        <section className="ticket-confirmation-dialog ticket-success-dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-success-title">
          <span className="success-mark"><Icon name="check" /></span>
          <h2 id="ticket-success-title">Ticket Created</h2>
          <p>Your ticket number is <strong>{ticket.id}</strong>.</p>
          <button className="primary-button" type="button" onClick={onClose}>OK</button>
        </section>
      </div>
    );
  }

  const summary = [
    ["Requester", ticket.requesterName],
    ["Email", ticket.email],
    ["Department", ticket.department || "-"],
    ["Category", ticket.category],
    ["Priority", ticket.priority],
    ["Asset / Device", ticket.asset || "-"],
    ["Subject", ticket.subject],
    ["Location", ticket.location || "-"],
    ["Description", ticket.description]
  ];

  return (
    <div className="dialog-backdrop" role="presentation">
      <section className="ticket-confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="ticket-review-title">
        <div className="dialog-title-row">
          <div>
            <h2 id="ticket-review-title">Review Ticket Details</h2>
            <p>Confirm that the information below is correct before sending it to Helpdesk.</p>
          </div>
        </div>
        <dl className="ticket-review-list">
          {summary.map(([label, value]) => (
            <div className={label === "Description" ? "review-row review-description" : "review-row"} key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        {error ? <p className="form-error">{error}</p> : null}
        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onBack} disabled={busy}>Back</button>
          <button className="primary-button" type="button" onClick={onConfirm} disabled={busy}>
            <Icon name="send" />
            {busy ? "Submitting..." : "Confirm Submission"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SubmissionHistory({ tickets, loading, notice }) {
  return (
    <aside className="submission-history panel" aria-labelledby="submission-history-title">
      <div className="history-heading">
        <span className="history-icon"><Icon name="clock" /></span>
        <div>
          <h2 id="submission-history-title">Your Ticket History</h2>
          <p>{tickets.length} submitted {tickets.length === 1 ? "ticket" : "tickets"}</p>
        </div>
      </div>
      {loading ? <p className="history-state">Loading your tickets...</p> : null}
      {notice ? <p className="form-error history-state">{notice}</p> : null}
      {!loading && !notice && !tickets.length ? (
        <p className="history-state">Your submitted tickets will appear here.</p>
      ) : null}
      <div className="history-list">
        {tickets.map((ticket) => (
          <article className="history-ticket" key={ticket.id}>
            <div className="history-ticket-topline">
              <strong>{ticket.id}</strong>
              <span className={`status-pill ${slug(ticket.status)}`}>{ticket.status}</span>
            </div>
            <h3>{ticket.subject}</h3>
            <div className="history-ticket-meta">
              <span><i className={`dot ${String(ticket.priority).toLowerCase()}`} />{ticket.priority}</span>
              <span>{ticket.category}</span>
              <time>{formatDate(ticket.createdAt)}</time>
            </div>
          </article>
        ))}
      </div>
    </aside>
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

function ChatPage({ panelMode = "full", auth, sessionId, onSessionEnded, onTicketCreated }) {
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
      if (response.ticketCreated) onTicketCreated?.(response);
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
      onSessionEnded?.("This conversation was saved and memory was cleared.");
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
      onSessionEnded?.("The conversation was archived and this tab’s memory was cleared.");
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
  return <img className={small ? "ava-icon ava-icon-small" : "ava-icon"} src="/ava-helpdesk-logo.png" alt="Ava assistant" />;
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

function formatDate(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString([], { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
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

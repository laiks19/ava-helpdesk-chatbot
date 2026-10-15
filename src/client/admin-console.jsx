import React, { useEffect, useMemo, useState } from "react";
import { buildClientManagerAlerts } from "./helpdesk-manager.js";

const adminOnlyTabs = ["MIS Dashboard", "Helpdesk Manager", "Tickets", "Technician KPI", "Users", "Technicians", "Ava Knowledge", "Security"];
const statuses = ["Open", "In Progress", "Waiting on User", "On Hold", "Resolved", "Closed"];
const managerSuggestions = [
  "How many tickets are overdue?",
  "Show all unassigned tickets.",
  "Which technician has the most open tickets?",
  "Summarize Major cases that are still unresolved.",
  "What should I prioritize today?"
];
const managerAlertLabels = {
  minor_sla_overdue: "Minor SLA overdue",
  major_sla_overdue: "Major SLA overdue",
  high_priority_unresolved: "High-priority unresolved",
  unassigned: "Unassigned ticket",
  stalled_in_progress: "Stalled In Progress"
};
const emptyTicket = {
  requesterName: "",
  email: "",
  department: "",
  category: "Hardware",
  priority: "Medium",
  caseType: "Minor",
  subject: "",
  description: "",
  asset: "",
  location: "",
  status: "Open",
  assignedTechnicianId: "",
  assignedTo: "",
  resolutionNote: ""
};

export function AdminConsole({ api, auth }) {
  const [tab, setTab] = useState("MIS Dashboard");
  const [credentials, setCredentials] = useState({ email: "kokseng.lai@ecoworld.my", password: "" });
  const [dashboard, setDashboard] = useState({ tickets: [], kpis: {}, technicianKpis: [], technicians: [] });
  const [kpiDashboard, setKpiDashboard] = useState({ tickets: [], kpis: {}, technicianKpis: [], technicians: [] });
  const [kpiFilters, setKpiFilters] = useState({ dateFrom: "", dateTo: "" });
  const [appliedKpiFilters, setAppliedKpiFilters] = useState({ dateFrom: "", dateTo: "" });
  const [users, setUsers] = useState([]);
  const [technicians, setTechnicians] = useState([]);
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [ticketEditor, setTicketEditor] = useState(null);
  const [userEditor, setUserEditor] = useState(null);
  const [technicianEditor, setTechnicianEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const token = auth.token;
  const isAdmin = auth.profile?.role === "admin" && auth.profile?.approvalStatus === "approved" && auth.profile?.isActive === true;

  useEffect(() => {
    if (!token || !isAdmin) return;
    Promise.allSettled([
      api.adminDashboard(token),
      api.adminUsers(token),
      api.adminTechnicians(token),
      api.pdfs(token)
    ]).then(([dashboardResult, userResult, technicianResult, pdfResult]) => {
      if (dashboardResult.status === "fulfilled") {
        setDashboard(dashboardResult.value);
        setKpiDashboard(dashboardResult.value);
      }
      if (userResult.status === "fulfilled") setUsers(userResult.value.users || []);
      if (technicianResult.status === "fulfilled") setTechnicians(technicianResult.value.technicians || []);
      if (pdfResult.status === "fulfilled") setFiles(pdfResult.value.files || []);
      const failures = [dashboardResult, userResult, technicianResult, pdfResult].filter((result) => result.status === "rejected");
      if (failures.length) setNotice(`${failures.length} admin section${failures.length === 1 ? "" : "s"} could not be loaded. You can still use the available sections.`);
    });
  }, [api, isAdmin, token]);

  async function login(event) {
    event.preventDefault();
    await run(async () => {
      const profile = await auth.signIn(credentials.email, credentials.password);
      if (profile.role !== "admin") throw new Error("This account does not have administrator access.");
    }, "Administrator access granted.");
  }

  async function saveTicket(event) {
    event.preventDefault();
    const payload = {
      ...ticketEditor,
      assignedTo: technicians.find((item) => item.id === ticketEditor.assignedTechnicianId)?.name || ""
    };
    await run(async () => {
      const result = ticketEditor.id
        ? await api.adminUpdateTicket(token, ticketEditor.id, payload)
        : await api.adminCreateTicket(token, payload);
      setDashboard(result);
      setKpiDashboard(await api.adminDashboard(token, appliedKpiFilters));
      setTicketEditor(null);
    }, ticketEditor.id ? "Ticket updated." : "Ticket created.");
  }

  async function deleteTicket(ticket) {
    if (!window.confirm(`Delete ${ticket.id}? Its audit history will be retained.`)) return;
    await run(async () => {
      setDashboard(await api.adminDeleteTicket(token, ticket.id));
      setKpiDashboard(await api.adminDashboard(token, appliedKpiFilters));
    }, `${ticket.id} deleted.`);
  }

  async function saveUser(event) {
    event.preventDefault();
    await run(async () => {
      const result = userEditor.id
        ? await api.adminUpdateUser(token, userEditor.id, userEditor)
        : await api.adminCreateUser(token, userEditor);
      setUsers(result.users || []);
      setUserEditor(null);
    }, userEditor.id ? "User updated." : "User added.");
  }

  async function userAction(user, action) {
    if (action === "delete" && !window.confirm(`Delete the account for ${user.email}?`)) return;
    await run(async () => {
      const result = action === "approve"
        ? await api.adminApproveUser(token, user.id)
        : action === "reject"
          ? await api.adminRejectUser(token, user.id)
          : await api.adminDeleteUser(token, user.id);
      setUsers(result.users || []);
    }, `User ${action}d.`);
  }

  async function saveTechnician(event) {
    event.preventDefault();
    await run(async () => {
      const result = technicianEditor.id
        ? await api.adminUpdateTechnician(token, technicianEditor.id, technicianEditor)
        : await api.adminCreateTechnician(token, technicianEditor);
      setTechnicians(result.technicians || []);
      setTechnicianEditor(null);
      setDashboard(await api.adminDashboard(token));
      setKpiDashboard(await api.adminDashboard(token, appliedKpiFilters));
    }, technicianEditor.id ? "Technician updated." : "Technician added.");
  }

  async function deleteTechnician(technician) {
    if (!window.confirm(`Remove ${technician.name} from active assignment choices?`)) return;
    await run(async () => {
      const result = await api.adminDeleteTechnician(token, technician.id);
      setTechnicians(result.technicians || []);
      setDashboard(await api.adminDashboard(token));
      setKpiDashboard(await api.adminDashboard(token, appliedKpiFilters));
    }, "Technician removed or deactivated.");
  }

  async function uploadPdfs(event) {
    event.preventDefault();
    if (!selectedFiles.length) return;
    await run(async () => {
      const result = await api.uploadPdfs(token, selectedFiles);
      setFiles(result.files || []);
      setSelectedFiles([]);
    }, "PDF library updated and chunked.");
  }

  async function deletePdf(file) {
    if (!window.confirm(`Remove ${file.originalName} from Ava's knowledge library?`)) return;
    await run(async () => {
      const result = await api.deletePdf(token, file.id);
      setFiles(result.files || []);
    }, "PDF removed.");
  }

  async function applyKpiFilters(event) {
    event.preventDefault();
    if (kpiFilters.dateFrom && kpiFilters.dateTo && kpiFilters.dateFrom > kpiFilters.dateTo) {
      setNotice("Ticket date from must be before or the same as ticket date to.");
      return;
    }
    await run(async () => {
      setKpiDashboard(await api.adminDashboard(token, kpiFilters));
      setAppliedKpiFilters({ ...kpiFilters });
    }, "Technician KPI date filter applied.");
  }

  async function clearKpiFilters() {
    const cleared = { dateFrom: "", dateTo: "" };
    await run(async () => {
      setKpiFilters(cleared);
      setAppliedKpiFilters(cleared);
      setKpiDashboard(await api.adminDashboard(token, cleared));
    }, "Technician KPI date filter cleared.");
  }

  async function run(action, success) {
    setBusy(true);
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  if (!token) {
    return (
      <main className="admin-workspace">
        <section className="admin-card panel compact-admin-login">
          <h1>Administrator login</h1>
          <p>Manage tickets, users, technicians, Ava knowledge, and account security.</p>
          <form className="login-form" onSubmit={login}>
            <label className="field"><span>Admin email</span><input type="email" value={credentials.email} onChange={(event) => setCredentials({ ...credentials, email: event.target.value })} required /></label>
            <label className="field"><span>Password</span><input type="password" value={credentials.password} onChange={(event) => setCredentials({ ...credentials, password: event.target.value })} required /></label>
            <button className="primary-button pressable" type="submit" disabled={busy}>{busy ? "Logging in..." : "Log in"}</button>
          </form>
          {notice ? <p className="notice compact">{notice}</p> : null}
        </section>
      </main>
    );
  }

  if (!isAdmin) {
    return <main className="admin-workspace"><section className="admin-card panel"><h1>Admin access required</h1><p>Your account does not have administrator access.</p><button className="secondary-button" type="button" onClick={auth.signOut}>Log out</button></section></main>;
  }

  return (
    <main className="admin-workspace">
      <section className="admin-card panel">
        <div className="admin-heading">
          <div><h1>Admin Console</h1><p>Operate the helpdesk from one workspace.</p></div>
          <button className="secondary-button pressable" type="button" onClick={auth.signOut}>Log out</button>
        </div>
        <div className="admin-tabs" role="tablist" aria-label="Administrator sections">
          {adminOnlyTabs.map((item) => <button className={tab === item ? "active" : ""} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} key={item}>{item}</button>)}
        </div>
        {notice ? <p className="notice compact">{notice}</p> : null}
        {tab === "MIS Dashboard" ? <AdminDashboard dashboard={dashboard} /> : null}
        <div hidden={tab !== "Helpdesk Manager"}><HelpdeskManager api={api} token={token} tickets={dashboard.tickets || []} /></div>
        {tab === "Tickets" ? <TicketAdmin tickets={dashboard.tickets} technicians={technicians} busy={busy} editor={ticketEditor} setEditor={setTicketEditor} onSave={saveTicket} onDelete={deleteTicket} /> : null}
        {tab === "Technician KPI" ? <TechnicianKpi dashboard={kpiDashboard} filters={kpiFilters} setFilters={setKpiFilters} busy={busy} onApply={applyKpiFilters} onClear={clearKpiFilters} /> : null}
        {tab === "Users" ? <UserAdmin users={users} busy={busy} editor={userEditor} setEditor={setUserEditor} onSave={saveUser} onAction={userAction} /> : null}
        {tab === "Technicians" ? <TechnicianAdmin technicians={technicians} busy={busy} editor={technicianEditor} setEditor={setTechnicianEditor} onSave={saveTechnician} onDelete={deleteTechnician} /> : null}
        {tab === "Ava Knowledge" ? <KnowledgeAdmin files={files} busy={busy} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} onUpload={uploadPdfs} onDelete={deletePdf} /> : null}
        {tab === "Security" ? <SecurityAdmin auth={auth} busy={busy} run={run} /> : null}
      </section>
    </main>
  );
}

function HelpdeskManager({ api, token, tickets }) {
  const initialAlerts = useMemo(() => buildClientManagerAlerts(tickets), [tickets]);
  const [alerts, setAlerts] = useState(initialAlerts);
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState([]);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState("");
  const [checkedAt, setCheckedAt] = useState(() => new Date().toISOString());
  const [scope, setScope] = useState(null);

  useEffect(() => {
    setAlerts(initialAlerts);
    setCheckedAt(new Date().toISOString());
  }, [initialAlerts]);

  const counts = alerts.reduce((summary, alert) => {
    summary[alert.severity] = (summary[alert.severity] || 0) + 1;
    return summary;
  }, { Critical: 0, High: 0, Medium: 0 });

  async function submitQuestion(event) {
    event.preventDefault();
    if (requesting || !question.trim()) return;
    const submittedQuestion = question.trim();
    setRequesting(true);
    setError("");
    setMessages((current) => [...current, { role: "manager", content: submittedQuestion }]);
    try {
      const result = await api.helpdeskManagerQuery(token, submittedQuestion);
      setAlerts(Array.isArray(result.alerts) ? result.alerts : []);
      setCheckedAt(result.checkedAt || new Date().toISOString());
      setScope(result.scope || null);
      setMessages((current) => [...current, { role: "assistant", content: result.answer, checkedAt: result.checkedAt }]);
      setQuestion("");
    } catch (requestError) {
      if (Array.isArray(requestError.alerts)) setAlerts(requestError.alerts);
      if (requestError.checkedAt) setCheckedAt(requestError.checkedAt);
      if (requestError.scope) setScope(requestError.scope);
      setError(requestError.message || "Helpdesk Manager AI is unavailable. Alerts are still current.");
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section className="admin-section manager-workspace">
      <div className="admin-section-title manager-title">
        <div><h2>Helpdesk Manager</h2><p>Review active alerts and ask read-only questions about current ticket status.</p></div>
        <span>Checked {formatManagerTime(checkedAt)}</span>
      </div>

      <div className="manager-alert-summary" aria-label="Helpdesk alert severity summary">
        <strong>{alerts.length}<small>Attention alerts</small></strong>
        {Object.entries(counts).map(([severity, count]) => <span className={`manager-severity ${severity.toLowerCase()}`} key={severity}>{severity}<b>{count}</b></span>)}
      </div>

      <div className="manager-layout">
        <section className="manager-alerts" aria-labelledby="manager-alerts-title">
          <div className="manager-pane-heading"><h3 id="manager-alerts-title">Helpdesk alerts</h3><span>Highest severity first</span></div>
          {alerts.length ? (
            <div className="manager-alert-list">
              {alerts.map((alert) => (
                <article className={`manager-alert ${alert.severity.toLowerCase()}`} key={alert.id}>
                  <div className="manager-alert-heading"><span>{alert.severity}</span><strong>{managerAlertLabels[alert.rule] || "Attention required"}</strong></div>
                  <h4>{alert.ticketNumber} · {alert.subject}</h4>
                  <p>{alert.reason}</p>
                  <small>{alert.technicianName || "Unassigned"} · {alert.status} · {alert.priority} · {alert.caseType}</small>
                </article>
              ))}
            </div>
          ) : <p className="manager-healthy">No helpdesk alerts need attention.</p>}
        </section>

        <section className="manager-query" aria-labelledby="manager-query-title">
          <div className="manager-pane-heading"><h3 id="manager-query-title">Ask about current helpdesk status</h3><span>Read-only analysis</span></div>
          <div className="manager-suggestions" aria-label="Suggested questions">
            {managerSuggestions.map((suggestion) => <button type="button" onClick={() => setQuestion(suggestion)} disabled={requesting} key={suggestion}>{suggestion}</button>)}
          </div>
          <div className="manager-transcript" aria-live="polite">
            {!messages.length ? <p>Ask for ticket counts, technician workload, overdue cases, or today's priorities.</p> : null}
            {messages.map((message, index) => (
              <div className={`manager-message ${message.role}`} key={`${message.role}-${index}`}>
                <strong>{message.role === "assistant" ? "Manager analysis" : "You"}</strong>
                <p>{message.content}</p>
                {message.checkedAt ? <small>Data checked {formatManagerTime(message.checkedAt)}</small> : null}
              </div>
            ))}
            {requesting ? <p className="manager-loading">Reviewing current helpdesk data...</p> : null}
          </div>
          {scope?.truncated ? <p className="manager-scope">This answer's snapshot limited to {scope.includedTicketCount} of {scope.totalTicketCount} tickets.</p> : null}
          {error ? <p className="manager-error" role="alert">{error}</p> : null}
          <form className="manager-composer" onSubmit={submitQuestion}>
            <label htmlFor="manager-question">Manager question</label>
            <textarea id="manager-question" maxLength="1000" value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about overdue, unassigned, Major, or technician tickets..." disabled={requesting} />
            <div><span>{question.length} / 1,000</span><button className="primary-button" type="submit" disabled={requesting || !question.trim()}>{requesting ? "Checking..." : "Send"}</button></div>
          </form>
        </section>
      </div>
    </section>
  );
}

function AdminDashboard({ dashboard }) {
  const tickets = dashboard.tickets || [];
  const kpis = dashboard.kpis || {};
  const priorities = kpis.byPriority || {};
  const statuses = kpis.byStatus || {};
  const priorityTotal = Math.max(1, Object.values(priorities).reduce((sum, value) => sum + value, 0));

  return (
    <section className="admin-section admin-dashboard">
      <div className="admin-section-title">
        <div><h2>MIS Helpdesk Overview</h2><p>Private ticket performance, workload, and support progress.</p></div>
        <span className="dashboard-private-label">Admin only</span>
      </div>
      <div className="kpi-grid">
        <Kpi title="Open Tickets" value={kpis.openTickets ?? 0} tone="blue" />
        <Kpi title="Closed Today" value={kpis.closedToday ?? 0} tone="green" />
        <Kpi title="Avg Resolution" value={`${kpis.averageResolutionHours ?? 0}h`} tone="cyan" />
        <Kpi title="SLA Met" value={`${kpis.slaMetPercent ?? 100}%`} tone="green" />
      </div>
      <div className="analytics-grid">
        <article className="chart-card">
          <h3>Tickets by Priority</h3>
          <div className="priority-summary">
            {Object.entries(priorities).map(([label, value]) => (
              <div className="priority-row" key={label}><span><i className={`dot ${label.toLowerCase()}`} />{label}</span><strong>{value}</strong><span className="priority-track"><i style={{ width: `${Math.max(4, (value / priorityTotal) * 100)}%` }} /></span></div>
            ))}
            {!Object.keys(priorities).length ? <p className="notice compact">No priority data yet.</p> : null}
          </div>
        </article>
        <article className="chart-card">
          <h3>Support Status</h3>
          <div className="status-summary">
            {Object.entries(statuses).map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong></div>)}
            {!Object.keys(statuses).length ? <p className="notice compact">No status data yet.</p> : null}
          </div>
        </article>
      </div>
      <article className="technician-progress">
        <div className="table-title"><div><h3>Technician Progress</h3><p>Current workload by IT support technician.</p></div></div>
        <div className="tech-head"><span>Technician</span><span>Open</span><span>In Progress</span><span>Closed</span><span>Total</span></div>
        {(dashboard.technicianKpis || []).map((row) => <div className="tech-row" key={row.id || row.name}><span><strong>{row.name}</strong></span><span>{row.open || 0}</span><span>{row.inProgress || 0}</span><span>{row.closed || 0}</span><span>{row.total || 0}</span></div>)}
        {!dashboard.technicianKpis?.length ? <p className="notice compact">Add technicians and assign tickets to begin tracking progress.</p> : null}
      </article>
      <div className="admin-data-table dashboard-ticket-list">
        <div className="admin-data-head"><span>Ticket</span><span>Requester</span><span>Technician</span><span>Status</span><span>Priority</span></div>
        {tickets.slice(0, 8).map((ticket) => <div className="admin-data-row" key={ticket.id}><span><strong>{ticket.id}</strong><small>{ticket.subject}</small></span><span>{ticket.requesterName}<small>{ticket.department || "-"}</small></span><span>{ticket.assignedTo || "Unassigned"}</span><span><i className={`status-pill ${slug(ticket.status)}`}>{ticket.status}</i></span><span>{ticket.priority}</span></div>)}
      </div>
    </section>
  );
}

function Kpi({ title, value, tone }) {
  return <article className={`kpi-card ${tone}`}><div><p>{title}</p><strong>{value}</strong><small>Current helpdesk data</small></div></article>;
}

function TechnicianKpi({ dashboard, filters, setFilters, busy, onApply, onClear }) {
  const technicians = (dashboard.technicianKpis || []).filter((row) => row.technicianId !== "unassigned");
  const filteredCount = dashboard.tickets?.length || 0;
  return (
    <section className="admin-section technician-kpi-section">
      <div className="admin-section-title">
        <div>
          <h2>Technician Performance KPI</h2>
          <p>Measured from ticket creation time to completion time for every assigned ticket.</p>
        </div>
        <span className="dashboard-private-label">Admin only</span>
      </div>
      <div className="kpi-rules" aria-label="KPI formulas">
        <div><strong>Minor KPI</strong><span>Closed within 5 hours / all Minor tickets</span></div>
        <div><strong>Major KPI</strong><span>Closed within 36 hours / all Major tickets</span></div>
      </div>
      <form className="kpi-date-filter" onSubmit={onApply}>
        <div className="kpi-date-fields">
          <label><span>Ticket date from</span><input type="date" value={filters.dateFrom} onChange={(event) => setFilters({ ...filters, dateFrom: event.target.value })} /></label>
          <label><span>Ticket date to</span><input type="date" value={filters.dateTo} onChange={(event) => setFilters({ ...filters, dateTo: event.target.value })} /></label>
        </div>
        <div className="kpi-filter-actions">
          <span>{filteredCount} {filteredCount === 1 ? "ticket" : "tickets"} in view</span>
          <button className="secondary-button" type="button" onClick={onClear} disabled={busy || (!filters.dateFrom && !filters.dateTo)}>Clear</button>
          <button className="primary-button" type="submit" disabled={busy}>{busy ? "Applying..." : "Apply filter"}</button>
        </div>
      </form>
      <div className="technician-kpi-chart" aria-label="Technician KPI performance chart">
        <div className="kpi-chart-heading">
          <div><h3>KPI Performance by Technician</h3><p>Percentage of assigned tickets completed within the target time.</p></div>
          <div className="kpi-chart-legend" aria-label="Chart legend"><span><i className="minor" />Minor</span><span><i className="major" />Major</span></div>
        </div>
        <div className="kpi-chart-scale" aria-hidden="true"><span>0%</span><span>50%</span><span>100%</span></div>
        <div className="kpi-chart-rows">
          {technicians.map((row) => <TechnicianKpiChartRow row={row} key={row.technicianId} />)}
          {!technicians.length ? <p className="history-state">No technician KPI data for this ticket date range.</p> : null}
        </div>
      </div>
      <div className="technician-kpi-table">
        <div className="technician-kpi-head">
          <span>Technician</span><span>Total Tickets</span><span>Minor Achieved</span><span>Minor KPI</span><span>Major Achieved</span><span>Major KPI</span><span>Avg Completion</span>
        </div>
        {technicians.map((row) => (
          <div className="technician-kpi-row" key={row.technicianId}>
            <span><strong>{row.name}</strong></span>
            <span className="kpi-number">{row.total}</span>
            <span>{row.minor.achieved} / {row.minor.total}</span>
            <KpiMeter value={row.minor.kpiPercent} />
            <span>{row.major.achieved} / {row.major.total}</span>
            <KpiMeter value={row.major.kpiPercent} />
            <span>{row.averageResolutionHours}h</span>
          </div>
        ))}
        {!technicians.length ? <p className="history-state">Add technicians and assign tickets to begin measuring KPI performance.</p> : null}
      </div>
    </section>
  );
}

function TechnicianKpiChartRow({ row }) {
  return (
    <div className="kpi-chart-row">
      <strong>{row.name}</strong>
      <div className="kpi-chart-bars">
        <div><span>Minor</span><i><b className="minor" style={{ width: `${Math.min(100, Math.max(0, row.minor.kpiPercent))}%` }} /></i><em>{row.minor.kpiPercent}%</em></div>
        <div><span>Major</span><i><b className="major" style={{ width: `${Math.min(100, Math.max(0, row.major.kpiPercent))}%` }} /></i><em>{row.major.kpiPercent}%</em></div>
      </div>
    </div>
  );
}

function KpiMeter({ value = 0 }) {
  return (
    <span className="kpi-meter">
      <strong>{value}%</strong>
      <i><b style={{ width: `${Math.min(100, Math.max(0, value))}%` }} /></i>
    </span>
  );
}

function TicketAdmin({ tickets, technicians, busy, editor, setEditor, onSave, onDelete }) {
  return (
    <section className="admin-section">
      <div className="admin-section-title"><div><h2>Tickets</h2><p>Add, edit, assign, close, or delete support records.</p></div><button className="primary-button" type="button" onClick={() => setEditor({ ...emptyTicket })}>Add ticket</button></div>
      {editor ? <TicketEditor value={editor} setValue={setEditor} technicians={technicians} busy={busy} onSave={onSave} onCancel={() => setEditor(null)} /> : null}
      <div className="admin-data-table">
        <div className="admin-data-head"><span>Ticket</span><span>Requester</span><span>Technician</span><span>Status</span><span>Actions</span></div>
        {tickets.map((ticket) => (
          <div className="admin-data-row" key={ticket.id}>
            <span><strong>{ticket.id}</strong><small>{ticket.subject}</small></span>
            <span>{ticket.requesterName}<small>{ticket.email}</small></span>
            <span>{ticket.assignedTo || "Unassigned"}</span>
            <span><i className={`status-pill ${slug(ticket.status)}`}>{ticket.status}</i></span>
            <span className="row-actions"><button type="button" onClick={() => setEditor({ ...ticket })}>Edit</button><button className="danger-link" type="button" onClick={() => onDelete(ticket)}>Delete</button></span>
          </div>
        ))}
      </div>
    </section>
  );
}

function TicketEditor({ value, setValue, technicians, busy, onSave, onCancel }) {
  const update = (key, next) => setValue({ ...value, [key]: next });
  return (
    <form className="admin-editor" onSubmit={onSave}>
      <h3>{value.id ? `Edit ${value.id}` : "Add ticket"}</h3>
      <div className="editor-grid">
        <label><span>Requester name</span><input value={value.requesterName} onChange={(e) => update("requesterName", e.target.value)} required /></label>
        <label><span>Email</span><input type="email" value={value.email} onChange={(e) => update("email", e.target.value)} required /></label>
        <label><span>Department</span><input value={value.department || ""} onChange={(e) => update("department", e.target.value)} /></label>
        <label><span>Category</span><input value={value.category} onChange={(e) => update("category", e.target.value)} required /></label>
        <label><span>Priority</span><select value={value.priority} onChange={(e) => update("priority", e.target.value)}><option>Critical</option><option>High</option><option>Medium</option><option>Low</option></select></label>
        <label><span>Case Type</span><select value={value.caseType || "Minor"} onChange={(e) => update("caseType", e.target.value)}><option>Minor</option><option>Major</option></select></label>
        <label><span>Status</span><select value={value.status || "Open"} onChange={(e) => update("status", e.target.value)}>{statuses.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span>Technician</span><select value={value.assignedTechnicianId || ""} onChange={(e) => update("assignedTechnicianId", e.target.value)}><option value="">Unassigned</option>{technicians.filter((item) => item.isActive).map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
        <label><span>Subject</span><input value={value.subject} onChange={(e) => update("subject", e.target.value)} required /></label>
        <label className="editor-wide"><span>Description</span><textarea value={value.description} onChange={(e) => update("description", e.target.value)} required /></label>
        <label className="editor-wide"><span>Resolution note</span><textarea value={value.resolutionNote || ""} onChange={(e) => update("resolutionNote", e.target.value)} /></label>
      </div>
      <div className="dialog-actions"><button className="secondary-button" type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save ticket</button></div>
    </form>
  );
}

function UserAdmin({ users, busy, editor, setEditor, onSave, onAction }) {
  return (
    <section className="admin-section">
      <div className="admin-section-title"><div><h2>Users</h2><p>Manage account status and assign administrator or user access.</p></div><button className="primary-button" type="button" onClick={() => setEditor({ fullName: "", email: "", department: "", password: "", role: "user", approvalStatus: "approved", isActive: true })}>Add user</button></div>
      {editor ? (
        <form className="admin-editor editor-grid" onSubmit={onSave}>
          <label><span>Name</span><input value={editor.fullName} onChange={(e) => setEditor({ ...editor, fullName: e.target.value })} required /></label>
          <label><span>Email</span><input type="email" value={editor.email} onChange={(e) => setEditor({ ...editor, email: e.target.value })} required disabled={Boolean(editor.id)} /></label>
          {!editor.id ? <label><span>Temporary password</span><input type="password" value={editor.password} onChange={(e) => setEditor({ ...editor, password: e.target.value })} required minLength="8" /></label> : null}
          <label><span>Department</span><input value={editor.department || ""} onChange={(e) => setEditor({ ...editor, department: e.target.value })} /></label>
          <label><span>Access right</span><select value={editor.role} onChange={(e) => setEditor({ ...editor, role: e.target.value })}><option value="user">User</option><option value="admin">Admin</option></select></label>
          <label><span>Approval</span><select value={editor.approvalStatus} onChange={(e) => setEditor({ ...editor, approvalStatus: e.target.value })}><option value="pending">Pending</option><option value="approved">Approved</option><option value="rejected">Rejected</option></select></label>
          <div className="dialog-actions editor-wide"><button className="secondary-button" type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save user</button></div>
        </form>
      ) : null}
      <div className="admin-data-table">
        <div className="admin-data-head"><span>User</span><span>Department</span><span>Access</span><span>Approval</span><span>Actions</span></div>
        {users.map((user) => <div className="admin-data-row" key={user.id}><span><strong>{user.fullName}</strong><small>{user.email}</small></span><span>{user.department || "-"}</span><span>{user.role}</span><span>{user.approvalStatus}</span><span className="row-actions">{user.approvalStatus === "pending" ? <><button type="button" onClick={() => onAction(user, "approve")}>Approve</button><button type="button" onClick={() => onAction(user, "reject")}>Reject</button></> : null}<button type="button" onClick={() => setEditor({ ...user })}>Edit</button><button className="danger-link" type="button" onClick={() => onAction(user, "delete")}>Delete</button></span></div>)}
      </div>
    </section>
  );
}

function TechnicianAdmin({ technicians, busy, editor, setEditor, onSave, onDelete }) {
  return (
    <section className="admin-section">
      <div className="admin-section-title"><div><h2>Technicians</h2><p>Maintain the IT support names available for ticket assignment.</p></div><button className="primary-button" type="button" onClick={() => setEditor({ name: "", email: "", isActive: true })}>Add technician</button></div>
      {editor ? <form className="admin-editor editor-grid" onSubmit={onSave}><label><span>Name</span><input value={editor.name} onChange={(e) => setEditor({ ...editor, name: e.target.value })} required /></label><label><span>Email</span><input type="email" value={editor.email || ""} onChange={(e) => setEditor({ ...editor, email: e.target.value })} /></label><label className="check-field"><input type="checkbox" checked={editor.isActive} onChange={(e) => setEditor({ ...editor, isActive: e.target.checked })} /><span>Active for assignment</span></label><div className="dialog-actions editor-wide"><button className="secondary-button" type="button" onClick={() => setEditor(null)}>Cancel</button><button className="primary-button" type="submit" disabled={busy}>Save technician</button></div></form> : null}
      <div className="admin-data-table compact-columns">
        <div className="admin-data-head"><span>Name</span><span>Email</span><span>Status</span><span>Actions</span></div>
        {technicians.map((item) => <div className="admin-data-row" key={item.id}><span><strong>{item.name}</strong></span><span>{item.email || "-"}</span><span>{item.isActive ? "Active" : "Inactive"}</span><span className="row-actions"><button type="button" onClick={() => setEditor({ ...item })}>Edit</button><button className="danger-link" type="button" onClick={() => onDelete(item)}>Remove</button></span></div>)}
      </div>
    </section>
  );
}

function KnowledgeAdmin({ files, busy, selectedFiles, setSelectedFiles, onUpload, onDelete }) {
  return <section className="admin-section"><div className="admin-section-title"><div><h2>Ava Knowledge</h2><p>Upload PDFs for local chunked search before OpenAI fallback.</p></div></div><form className="upload-box" onSubmit={onUpload}><input id="admin-pdfs" type="file" multiple accept="application/pdf,.pdf" onChange={(event) => setSelectedFiles(event.target.files)} /><label htmlFor="admin-pdfs"><strong>Choose PDF knowledge files</strong><span>{selectedFiles.length ? `${selectedFiles.length} selected` : "Up to 50 files"}</span></label><button className="primary-button" type="submit" disabled={busy || !selectedFiles.length}>Upload and index</button></form><div className="admin-data-table compact-columns">{files.map((file) => <div className="admin-data-row" key={file.id}><span><strong>{file.originalName}</strong></span><span>{file.pages || "-"} pages</span><span>Indexed</span><span className="row-actions"><button className="danger-link" type="button" onClick={() => onDelete(file)}>Delete</button></span></div>)}</div></section>;
}

function SecurityAdmin({ auth, busy, run }) {
  const [passwords, setPasswords] = useState({ current: "", next: "", confirm: "" });
  async function submit(event) {
    event.preventDefault();
    if (passwords.next !== passwords.confirm) {
      await run(async () => { throw new Error("New passwords do not match."); }, "");
      return;
    }
    await run(async () => {
      await auth.changePassword(passwords.current, passwords.next);
      setPasswords({ current: "", next: "", confirm: "" });
    }, "Password changed.");
  }
  return <section className="admin-section security-panel"><h2>Security</h2><p>Change the administrator password used for this account.</p>{auth.profile?.mustChangePassword ? <p className="security-warning">Change the bootstrap password before using other administrator tools.</p> : null}<form className="admin-editor" onSubmit={submit}><label><span>Current password</span><input type="password" value={passwords.current} onChange={(e) => setPasswords({ ...passwords, current: e.target.value })} required /></label><label><span>New password</span><input type="password" value={passwords.next} onChange={(e) => setPasswords({ ...passwords, next: e.target.value })} minLength="8" required /></label><label><span>Confirm new password</span><input type="password" value={passwords.confirm} onChange={(e) => setPasswords({ ...passwords, confirm: e.target.value })} minLength="8" required /></label><button className="primary-button" type="submit" disabled={busy}>Change password</button></form></section>;
}

function slug(value = "") {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function formatManagerTime(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "not available";
}

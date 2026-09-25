import React, { useEffect, useState } from "react";

const tabs = ["Tickets", "Users", "Technicians", "Ava Knowledge", "Security"];
const statuses = ["Open", "In Progress", "Waiting on User", "On Hold", "Resolved", "Closed"];
const emptyTicket = {
  requesterName: "",
  email: "",
  department: "",
  category: "Hardware",
  priority: "Medium",
  subject: "",
  description: "",
  asset: "",
  location: "",
  status: "Open",
  assignedTechnicianId: "",
  assignedTo: "",
  resolutionNote: ""
};

export function AdminConsole({ api, auth, dashboard, onDashboard }) {
  const [tab, setTab] = useState("Tickets");
  const [credentials, setCredentials] = useState({ email: "kokseng.lai@ecoworld.my", password: "" });
  const [users, setUsers] = useState([]);
  const [technicians, setTechnicians] = useState(dashboard.technicians || []);
  const [files, setFiles] = useState([]);
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [ticketEditor, setTicketEditor] = useState(null);
  const [userEditor, setUserEditor] = useState(null);
  const [technicianEditor, setTechnicianEditor] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  const token = auth.token;
  const isAdmin = auth.profile?.role === "admin";

  useEffect(() => {
    if (!token || !isAdmin) return;
    Promise.all([
      api.adminTickets(token),
      api.adminUsers(token),
      api.adminTechnicians(token),
      api.pdfs(token)
    ]).then(([ticketData, userData, technicianData, pdfData]) => {
      onDashboard(ticketData);
      setUsers(userData.users || []);
      setTechnicians(technicianData.technicians || []);
      setFiles(pdfData.files || []);
    }).catch((error) => setNotice(error.message));
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
      onDashboard(result);
      setTicketEditor(null);
    }, ticketEditor.id ? "Ticket updated." : "Ticket created.");
  }

  async function deleteTicket(ticket) {
    if (!window.confirm(`Delete ${ticket.id}? Its audit history will be retained.`)) return;
    await run(async () => onDashboard(await api.adminDeleteTicket(token, ticket.id)), `${ticket.id} deleted.`);
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
      onDashboard(await api.adminTickets(token));
    }, technicianEditor.id ? "Technician updated." : "Technician added.");
  }

  async function deleteTechnician(technician) {
    if (!window.confirm(`Remove ${technician.name} from active assignment choices?`)) return;
    await run(async () => {
      const result = await api.adminDeleteTechnician(token, technician.id);
      setTechnicians(result.technicians || []);
      onDashboard(await api.adminTickets(token));
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
          {tabs.map((item) => <button className={tab === item ? "active" : ""} type="button" role="tab" aria-selected={tab === item} onClick={() => setTab(item)} key={item}>{item}</button>)}
        </div>
        {notice ? <p className="notice compact">{notice}</p> : null}
        {tab === "Tickets" ? <TicketAdmin tickets={dashboard.tickets} technicians={technicians} busy={busy} editor={ticketEditor} setEditor={setTicketEditor} onSave={saveTicket} onDelete={deleteTicket} /> : null}
        {tab === "Users" ? <UserAdmin users={users} busy={busy} editor={userEditor} setEditor={setUserEditor} onSave={saveUser} onAction={userAction} /> : null}
        {tab === "Technicians" ? <TechnicianAdmin technicians={technicians} busy={busy} editor={technicianEditor} setEditor={setTechnicianEditor} onSave={saveTechnician} onDelete={deleteTechnician} /> : null}
        {tab === "Ava Knowledge" ? <KnowledgeAdmin files={files} busy={busy} selectedFiles={selectedFiles} setSelectedFiles={setSelectedFiles} onUpload={uploadPdfs} onDelete={deletePdf} /> : null}
        {tab === "Security" ? <SecurityAdmin auth={auth} busy={busy} run={run} /> : null}
      </section>
    </main>
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
      <div className="admin-section-title"><div><h2>Users</h2><p>Approve registrations and assign administrator or user access.</p></div><button className="primary-button" type="button" onClick={() => setEditor({ fullName: "", email: "", department: "", password: "", role: "user", approvalStatus: "approved", isActive: true })}>Add user</button></div>
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

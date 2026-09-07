import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { connectionErrorMessage, getApiBaseUrl } from "./api-base.js";
import "./styles.css";

const API_BASE_URL = getApiBaseUrl();

const api = {
  async health() {
    return request("/api/health");
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
  }
};

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
  if (!response.ok) throw new Error(payload.error || "Request failed");
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

function RobotIcon({ small = false }) {
  return (
    <div className={small ? "robot robot-small" : "robot"} aria-hidden="true">
      <span className="antenna" />
      <span className="face">
        <i />
        <i />
      </span>
    </div>
  );
}

function App() {
  const [route, setRoute] = useState(location.hash === "#admin" ? "admin" : "chat");
  useEffect(() => {
    const onHash = () => setRoute(location.hash === "#admin" ? "admin" : "chat");
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);

  return route === "admin" ? <AdminPage /> : <ChatPage />;
}

function ChatPage() {
  const sessionId = useMemo(getSessionId, []);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi, I’m Ava, your IT Helpdesk assistant. How can I help you today?",
      timestamp: new Date().toISOString(),
      source: "system"
    }
  ]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const scrollRef = useRef(null);

  useEffect(() => {
    api.session(sessionId).then((data) => {
      if (data.messages?.length) setMessages(data.messages);
    });
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
      const response = await api.chat(sessionId, text);
      setMessages((current) => [...current.filter((item) => item.content !== text || item.role !== "user"), ...response.messages]);
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

  return (
    <main className="app-shell">
      <section className="chat-panel">
        <div className="panel-title">
          <h2>Ask Ava</h2>
          <span>{sessionId.slice(0, 8)}</span>
        </div>
        <div className="messages" ref={scrollRef}>
          {messages.map((item, index) => (
            <Message key={`${item.timestamp}-${index}`} message={item} />
          ))}
          {busy && <div className="typing">Ava is checking the PDF library...</div>}
        </div>
        {notice && <p className="notice">{notice}</p>}
        <form className="composer" onSubmit={sendMessage}>
          <textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="Type your message here..."
            rows="2"
          />
          <button className="icon-button pressable" type="submit" disabled={busy} aria-label="Send message">
            <span>➤</span>
          </button>
        </form>
        <button className="end-button pressable" type="button" onClick={endConversation} disabled={busy}>
          End conversation
        </button>
      </section>
    </main>
  );
}

function Header() {
  return (
    <header className="header">
      <a className="brand" href="#">
        <RobotIcon />
        <span>Ava</span>
        <em>IT Helpdesk ChatBot</em>
      </a>
      <a className="admin-link pressable" href="#admin">Admin PDF Library</a>
    </header>
  );
}

function Message({ message }) {
  const isUser = message.role === "user";
  return (
    <article className={isUser ? "message user" : "message ava"}>
      {!isUser && <RobotIcon small />}
      <div>
        <p>{message.content}</p>
        <time>{new Date(message.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>
        {message.source && message.source !== "system" && (
          <span className="source-tag">
            {message.source === "local_pdf" ? "Local PDF" : message.source === "openai" ? "OpenAI" : message.source === "openai_error" ? "AI unavailable" : "Setup needed"}
          </span>
        )}
      </div>
    </article>
  );
}

function AdminPage() {
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
      setNotice("PDF library updated.");
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="admin-shell">
      <Header />
      <section className="admin-card">
        <div className="admin-heading">
          <div>
            <h1>Admin PDF Library</h1>
            <p>Upload up to 50 PDF files for Ava to search before using AI fallback.</p>
          </div>
          <div className="admin-actions">
            {token && (
              <button className="admin-link pressable" type="button" onClick={() => setToken("")}>
                Log out
              </button>
            )}
            <a className="admin-link pressable" href="#">Back to Chat</a>
          </div>
        </div>

        {!token ? (
          <form className="login-form" onSubmit={login}>
            <label>
              Admin username
              <input value={username} onChange={(event) => setUsername(event.target.value)} type="text" placeholder="Admin" autoComplete="username" />
            </label>
            <label>
              Admin password
              <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" placeholder="admin123" autoComplete="current-password" />
            </label>
            <button className="primary-button pressable" type="submit" disabled={busy}>Log in</button>
          </form>
        ) : (
          <>
            <form className="upload-box" onSubmit={upload}>
              <input
                id="pdfs"
                type="file"
                multiple
                accept="application/pdf,.pdf"
                onChange={(event) => setSelected(event.target.files)}
              />
              <label htmlFor="pdfs">
                <strong>Upload PDFs</strong>
                <span>{selected.length ? `${selected.length} selected` : "Drag files here or click to browse"}</span>
              </label>
              <button className="primary-button pressable" disabled={busy || !selected.length} type="submit">Upload PDFs</button>
            </form>
            <div className="library-table">
              <div className="table-head">
                <span>File Name</span><span>Size</span><span>Pages</span><span>Status</span>
              </div>
              {files.map((file) => (
                <div className="table-row" key={file.id}>
                  <span>{file.originalName}</span>
                  <span>{formatBytes(file.size)}</span>
                  <span>{file.pages || "-"}</span>
                  <span className="indexed">Indexed</span>
                </div>
              ))}
              {!files.length && <p className="notice">No PDFs uploaded yet.</p>}
            </div>
          </>
        )}
        {notice && <p className="notice">{notice}</p>}
      </section>
    </main>
  );
}

function formatBytes(bytes = 0) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

createRoot(document.getElementById("root")).render(<App />);

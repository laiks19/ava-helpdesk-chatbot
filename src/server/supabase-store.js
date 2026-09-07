export function isSupabaseConfigured(env = process.env) {
  return Boolean(
    env.SUPABASE_URL &&
      env.SUPABASE_SERVICE_ROLE_KEY &&
      env.SUPABASE_URL !== "your_supabase_project_url" &&
      env.SUPABASE_SERVICE_ROLE_KEY !== "your_supabase_service_role_key"
  );
}

export function getSupabaseConfig(env = process.env) {
  return {
    url: normalizeSupabaseUrl(env.SUPABASE_URL),
    key: env.SUPABASE_SERVICE_ROLE_KEY || "",
    bucket: env.SUPABASE_STORAGE_BUCKET || "helpdesk-pdfs"
  };
}

function normalizeSupabaseUrl(url) {
  return String(url || "")
    .replace(/\/+$/, "")
    .replace(/\/rest\/v1$/i, "")
    .replace(/\/storage\/v1$/i, "");
}

export function createSupabaseRestClient({ config = getSupabaseConfig(), fetchImpl = fetch } = {}) {
  const headers = {
    apikey: config.key,
    Authorization: `Bearer ${config.key}`,
    "Content-Type": "application/json"
  };

  async function request(path, options = {}) {
    const response = await fetchImpl(`${config.url}${path}`, {
      ...options,
      headers: {
        ...headers,
        ...(options.headers || {})
      }
    });
    if (!response.ok) {
      const details = await response.text().catch(() => "");
      throw new Error(`Supabase request failed (${response.status}): ${details}`);
    }
    if (response.status === 204) return null;
    if (typeof response.text === "function") {
      const text = await response.text();
      const trimmed = text.trim();
      return trimmed ? JSON.parse(trimmed) : null;
    }
    return response.json();
  }

  return {
    async loadDocuments() {
      const rows = await request(
        "/rest/v1/ava_documents?select=id,original_name,stored_name,size,uploaded_at,text,pages&order=uploaded_at.desc"
      );
      return rows.map(fromDocumentRow);
    },
    async saveDocument(document) {
      await request("/rest/v1/ava_documents", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify(toDocumentRow(document))
      });
    },
    async getSession(sessionId) {
      const rows = await request(
        `/rest/v1/ava_sessions?select=messages&session_id=eq.${encodeURIComponent(sessionId)}&limit=1`
      );
      return rows[0]?.messages || [];
    },
    async saveSession(sessionId, messages) {
      await request("/rest/v1/ava_sessions", {
        method: "POST",
        headers: { Prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          session_id: sessionId,
          messages,
          updated_at: new Date().toISOString()
        })
      });
    },
    async deleteSession(sessionId) {
      await request(`/rest/v1/ava_sessions?session_id=eq.${encodeURIComponent(sessionId)}`, {
        method: "DELETE"
      });
    },
    async saveConversationLog({ sessionId, messages, transcript }) {
      await request("/rest/v1/ava_conversation_logs", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          messages,
          transcript_md: transcript,
          ended_at: new Date().toISOString()
        })
      });
    },
    async uploadPdf({ storedName, buffer, contentType = "application/pdf" }) {
      const response = await fetchImpl(
        `${config.url}/storage/v1/object/${config.bucket}/${encodeURIComponent(storedName)}`,
        {
          method: "POST",
          headers: {
            apikey: config.key,
            Authorization: `Bearer ${config.key}`,
            "Content-Type": contentType,
            "x-upsert": "true"
          },
          body: buffer
        }
      );
      if (!response.ok) {
        const details = await response.text().catch(() => "");
        throw new Error(`Supabase storage upload failed (${response.status}): ${details}`);
      }
    }
  };
}

export async function loadSupabaseDocumentsSafely(supabaseClient) {
  try {
    return await supabaseClient.loadDocuments();
  } catch (error) {
    console.warn(`Supabase document load skipped: ${error.message || "unknown error"}`);
    return [];
  }
}

export async function getSupabaseSessionSafely(supabaseClient, sessionId) {
  try {
    return await supabaseClient.getSession(sessionId);
  } catch (error) {
    console.warn(`Supabase session load skipped: ${error.message || "unknown error"}`);
    return [];
  }
}

export async function saveSupabaseSessionSafely(supabaseClient, sessionId, messages) {
  try {
    await supabaseClient.saveSession(sessionId, messages);
  } catch (error) {
    console.warn(`Supabase session save skipped: ${error.message || "unknown error"}`);
  }
}

function toDocumentRow(document) {
  return {
    id: document.id,
    original_name: document.originalName,
    stored_name: document.storedName,
    size: document.size,
    uploaded_at: document.uploadedAt,
    text: document.text,
    pages: document.pages
  };
}

function fromDocumentRow(row) {
  return {
    id: row.id,
    originalName: row.original_name,
    storedName: row.stored_name,
    size: row.size,
    uploadedAt: row.uploaded_at,
    text: row.text || "",
    pages: row.pages || 0
  };
}

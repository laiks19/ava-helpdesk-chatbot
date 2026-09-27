export function getApiBaseUrl(locationLike = globalThis.location) {
  const hostname = locationLike?.hostname || "";
  if (hostname.endsWith(".chatgpt.site")) {
    return "http://127.0.0.1:3001";
  }
  return "";
}

export function connectionErrorMessage() {
  return "Ava cannot reach the local chatbot server. Start it with npm run server, then keep this page open and try again.";
}

export function buildAdminDashboardPath({ dateFrom = "", dateTo = "" } = {}) {
  const params = new URLSearchParams();
  if (dateFrom) params.set("dateFrom", dateFrom);
  if (dateTo) params.set("dateTo", dateTo);
  const query = params.toString();
  return `/api/admin/dashboard${query ? `?${query}` : ""}`;
}

export const CHAT_SESSION_KEY = "ava-tab-session-id";

export function getChatSessionId(
  storage = globalThis.sessionStorage,
  createId = () => globalThis.crypto.randomUUID()
) {
  let sessionId = storage.getItem(CHAT_SESSION_KEY);
  if (!sessionId) {
    sessionId = createId();
    storage.setItem(CHAT_SESSION_KEY, sessionId);
  }
  return sessionId;
}

export function peekChatSessionId(storage = globalThis.sessionStorage) {
  return storage.getItem(CHAT_SESSION_KEY);
}

export function clearChatSessionId(storage = globalThis.sessionStorage) {
  storage.removeItem(CHAT_SESSION_KEY);
}

export async function endChatBeforeSignOut({
  storage = globalThis.sessionStorage,
  endSession,
  signOut
}) {
  const sessionId = peekChatSessionId(storage);
  if (sessionId) {
    try {
      await endSession(sessionId);
    } catch {
      // Authentication logout must still work if the archive request is unavailable.
    }
    clearChatSessionId(storage);
  }
  await signOut();
}

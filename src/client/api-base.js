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

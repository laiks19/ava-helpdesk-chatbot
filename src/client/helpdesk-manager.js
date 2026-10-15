import { buildHelpdeskAlerts } from "../server/helpdesk-manager.js";

export function buildClientManagerAlerts(tickets = [], now = new Date()) {
  return buildHelpdeskAlerts({ tickets, now });
}

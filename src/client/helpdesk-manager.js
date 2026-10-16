import { buildHelpdeskAlerts } from "../server/helpdesk-manager.js";

export function buildClientManagerAlerts(tickets = [], now = new Date()) {
  return buildHelpdeskAlerts({ tickets, now });
}

export function summarizeOverallKpi(technicianKpis = []) {
  const emptyResult = () => ({
    total: 0,
    achieved: 0,
    closedLate: 0,
    activeOverdue: 0,
    activeWithinTarget: 0,
    kpiPercent: 0
  });
  const overall = { minor: emptyResult(), major: emptyResult() };

  for (const row of technicianKpis) {
    if (row.technicianId === "unassigned") continue;
    for (const caseType of ["minor", "major"]) {
      const value = row[caseType] || {};
      overall[caseType].total += Number(value.total) || 0;
      overall[caseType].achieved += Number(value.achieved) || 0;
      overall[caseType].closedLate += Number(value.closedLate) || 0;
      overall[caseType].activeOverdue += Number(value.activeOverdue) || 0;
      overall[caseType].activeWithinTarget += Number(value.activeWithinTarget) || 0;
    }
  }

  for (const value of Object.values(overall)) {
    value.kpiPercent = value.total ? Math.round((value.achieved / value.total) * 100) : 0;
  }

  return overall;
}

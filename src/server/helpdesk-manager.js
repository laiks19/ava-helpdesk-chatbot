const SEVERITY_RANK = { Critical: 0, High: 1, Medium: 2 };

export function validateManagerQuestion(value, maxLength = 1000) {
  const question = String(value ?? "").trim();
  if (!question) {
    return { valid: false, question, error: "Enter a helpdesk status question." };
  }
  if (question.length > maxLength) {
    return { valid: false, question, error: `Question must be ${maxLength.toLocaleString("en-US")} characters or fewer.` };
  }
  return { valid: true, question, error: null };
}

export function buildHelpdeskAlerts({ tickets = [], now = new Date() }) {
  const currentTime = toTimestamp(now);
  if (currentTime === null) return [];

  const alerts = [];
  for (const ticket of tickets) {
    if (ticket?.deletedAt || !isUnresolved(ticket?.status)) continue;

    const normalized = normalizeTicket(ticket);
    const ageHours = elapsedHours(ticket.createdAt, currentTime);
    const stalledSource = hasValue(ticket.updatedAt) ? ticket.updatedAt : ticket.createdAt;
    const stalledHours = elapsedHours(stalledSource, currentTime);
    const isMinorOverdue = normalized.caseTypeKey === "minor" && ageHours !== null && ageHours > 5;
    const isMajorOverdue = normalized.caseTypeKey === "major" && ageHours !== null && ageHours > 36;

    if (isMinorOverdue) {
      alerts.push(createAlert(normalized, {
        rule: "minor_sla_overdue",
        severity: normalized.priorityKey === "critical" ? "Critical" : "High",
        elapsedHours: ageHours,
        reason: `Minor ticket has been unresolved for ${formatHours(ageHours)}, beyond the 5-hour target.`
      }));
    }

    if (isMajorOverdue) {
      alerts.push(createAlert(normalized, {
        rule: "major_sla_overdue",
        severity: "Critical",
        elapsedHours: ageHours,
        reason: `Major ticket has been unresolved for ${formatHours(ageHours)}, beyond the 36-hour target.`
      }));
    }

    if (["critical", "high"].includes(normalized.priorityKey)) {
      alerts.push(createAlert(normalized, {
        rule: "high_priority_unresolved",
        severity: normalized.priorityKey === "critical" && (isMinorOverdue || isMajorOverdue) ? "Critical" : "High",
        elapsedHours: ageHours,
        reason: `${normalized.priority} priority ticket is still unresolved.`
      }));
    }

    if (!hasValue(ticket.assignedTo) && !hasValue(ticket.assignedTechnicianId)) {
      alerts.push(createAlert(normalized, {
        rule: "unassigned",
        severity: "Medium",
        elapsedHours: ageHours,
        reason: "Unresolved ticket has no assigned technician."
      }));
    }

    if (normalized.statusKey === "in progress" && stalledHours !== null && stalledHours > 24) {
      alerts.push(createAlert(normalized, {
        rule: "stalled_in_progress",
        severity: "High",
        elapsedHours: stalledHours,
        reason: `In Progress ticket has not been updated for ${formatHours(stalledHours)}.`
      }));
    }
  }

  return alerts.sort((left, right) => (
    SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity]
    || left.ticketNumber.localeCompare(right.ticketNumber)
    || left.rule.localeCompare(right.rule)
  ));
}

function normalizeTicket(ticket) {
  const status = displayValue(ticket.status, "Open");
  const priority = displayValue(ticket.priority, "Medium");
  const caseType = displayValue(ticket.caseType, "Unclassified");
  return {
    ticketNumber: displayValue(ticket.ticketNumber || ticket.id, "Unknown ticket"),
    subject: displayValue(ticket.subject, "No subject"),
    technicianName: displayValue(ticket.assignedTo, "Unassigned"),
    status,
    statusKey: normalizeKey(status),
    priority,
    priorityKey: normalizeKey(priority),
    caseType,
    caseTypeKey: normalizeKey(caseType)
  };
}

function createAlert(ticket, details) {
  return {
    id: `${ticket.ticketNumber}:${details.rule}`,
    rule: details.rule,
    severity: details.severity,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    technicianName: ticket.technicianName,
    status: ticket.status,
    priority: ticket.priority,
    caseType: ticket.caseType,
    elapsedHours: details.elapsedHours === null ? null : roundHours(details.elapsedHours),
    reason: details.reason
  };
}

function isUnresolved(status) {
  return !["resolved", "closed"].includes(normalizeKey(status));
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function displayValue(value, fallback) {
  const cleaned = String(value ?? "").trim();
  return cleaned || fallback;
}

function hasValue(value) {
  return String(value ?? "").trim().length > 0;
}

function elapsedHours(value, currentTime) {
  const timestamp = toTimestamp(value);
  if (timestamp === null || timestamp > currentTime) return null;
  return (currentTime - timestamp) / 3_600_000;
}

function toTimestamp(value) {
  const timestamp = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function roundHours(value) {
  return Math.round(value * 10) / 10;
}

function formatHours(value) {
  return `${roundHours(value)} hour${roundHours(value) === 1 ? "" : "s"}`;
}

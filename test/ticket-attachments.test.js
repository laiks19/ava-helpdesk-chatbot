import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";
import { createHelpdeskStore } from "../src/server/helpdesk-store.js";

const attachmentModule = await import("../src/server/ticket-attachments.js").catch(() => ({}));

test("ticket attachments accept the supported formats within the configured limits", () => {
  assert.equal(typeof attachmentModule.validateTicketAttachments, "function");
  const files = [
    { originalname: "error.png", mimetype: "image/png", size: 1024 },
    { originalname: "logs.zip", mimetype: "application/zip", size: 2048 }
  ];

  assert.deepEqual(attachmentModule.validateTicketAttachments(files), { valid: true });
});

test("ticket attachments reject unsupported files, oversized files, and more than five files", () => {
  assert.equal(typeof attachmentModule.validateTicketAttachments, "function");
  assert.match(
    attachmentModule.validateTicketAttachments([{ originalname: "run.exe", mimetype: "application/octet-stream", size: 10 }]).error,
    /PDF, JPG, PNG, or ZIP/i
  );
  assert.match(
    attachmentModule.validateTicketAttachments([{ originalname: "large.pdf", mimetype: "application/pdf", size: 10 * 1024 * 1024 + 1 }]).error,
    /10 MB/i
  );
  assert.match(
    attachmentModule.validateTicketAttachments(Array.from({ length: 6 }, (_, index) => ({ originalname: `${index}.pdf`, mimetype: "application/pdf", size: 10 }))).error,
    /up to 5/i
  );
});

test("ticket attachment content signatures reject a renamed executable", () => {
  assert.equal(typeof attachmentModule.validateTicketAttachmentContents, "function");
  assert.deepEqual(attachmentModule.validateTicketAttachmentContents([
    { originalname: "screen.png", buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]) },
    { originalname: "report.pdf", buffer: Buffer.from("%PDF-1.7") }
  ]), { valid: true });
  assert.match(
    attachmentModule.validateTicketAttachmentContents([{ originalname: "unsafe.jpg", buffer: Buffer.from("MZ executable") }]).error,
    /does not match/i
  );
});

test("attachment downloads are limited to administrators and the ticket owner", () => {
  assert.equal(typeof attachmentModule.canAccessTicketAttachment, "function");
  const ticket = { requesterUserId: "user-1" };

  assert.equal(attachmentModule.canAccessTicketAttachment({ id: "admin-1", role: "admin" }, ticket), true);
  assert.equal(attachmentModule.canAccessTicketAttachment({ id: "user-1", role: "user" }, ticket), true);
  assert.equal(attachmentModule.canAccessTicketAttachment({ id: "user-2", role: "user" }, ticket), false);
  assert.equal(attachmentModule.canAccessTicketAttachment(null, ticket), false);
});

test("signed attachment claims reject tampering before ticket metadata is saved", () => {
  assert.equal(typeof attachmentModule.createTicketAttachmentClaim, "function");
  assert.equal(typeof attachmentModule.verifyTicketAttachmentClaim, "function");
  const attachment = {
    originalName: "screen.png",
    storagePath: "pending/upload-screen.png",
    contentType: "image/png",
    sizeBytes: 2048,
    createdAt: "2026-10-22T01:00:00.000Z"
  };
  const claim = attachmentModule.createTicketAttachmentClaim(attachment, "test-secret");

  assert.deepEqual(
    attachmentModule.verifyTicketAttachmentClaim({ ...attachment, claim }, "test-secret", new Date("2026-10-22T01:05:00.000Z")),
    { valid: true, attachment }
  );
  assert.equal(
    attachmentModule.verifyTicketAttachmentClaim({ ...attachment, sizeBytes: 4096, claim }, "test-secret", new Date("2026-10-22T01:05:00.000Z")).valid,
    false
  );
});

test("upload intent limiter blocks excessive requests in one window", () => {
  assert.equal(typeof attachmentModule.createUploadIntentLimiter, "function");
  const limiter = attachmentModule.createUploadIntentLimiter({ limit: 2, windowMs: 60_000 });
  const now = new Date("2026-10-22T01:00:00.000Z");

  assert.equal(limiter.allow("client-1", now), true);
  assert.equal(limiter.allow("client-1", now), true);
  assert.equal(limiter.allow("client-1", now), false);
  assert.equal(limiter.allow("client-2", now), true);
  assert.equal(limiter.allow("client-1", new Date("2026-10-22T01:01:01.000Z")), true);
});

test("cleanup removes only old unreferenced pending uploads", async () => {
  assert.equal(typeof attachmentModule.createTicketAttachmentStorage, "function");
  const removed = [];
  const supabase = {
    storage: {
      from() {
        return {
          async list() {
            return { data: [
              { name: "referenced.png", created_at: "2026-10-22T00:00:00.000Z" },
              { name: "orphan.png", created_at: "2026-10-22T00:00:00.000Z" },
              { name: "recent.png", created_at: "2026-10-22T02:30:00.000Z" }
            ], error: null };
          },
          async remove(paths) { removed.push(...paths); return { error: null }; }
        };
      }
    }
  };
  const storage = attachmentModule.createTicketAttachmentStorage({ supabase });

  const result = await storage.cleanupPending({
    referencedPaths: ["pending/referenced.png"],
    now: new Date("2026-10-22T03:00:00.000Z"),
    olderThanMs: 2 * 60 * 60 * 1000
  });

  assert.deepEqual(removed, ["pending/orphan.png"]);
  assert.deepEqual(result, { removed: 1 });
});

test("failed submissions never select attachment objects already referenced by another ticket for cleanup", async () => {
  const store = createHelpdeskStore();
  await store.initialize();
  const ticket = await store.createTicket({
    requesterName: "Aina",
    email: "aina@example.com",
    department: "MIS",
    category: "Hardware",
    priority: "Medium",
    subject: "Printer error",
    description: "Printer is showing an error.",
    asset: "Printer",
    location: "HQ"
  });
  await store.addTicketAttachments(ticket.id, [{ id: "a-1", storagePath: "pending/used.png", originalName: "used.png" }]);

  assert.deepEqual(
    await store.unreferencedAttachmentPaths(["pending/used.png", "pending/orphan.png"]),
    ["pending/orphan.png"]
  );
});

test("ticket submission uses a real multi-file attachment control and multipart payload", async () => {
  const source = await readFile(new URL("../src/client/main.jsx", import.meta.url), "utf8");

  assert.match(source, /type="file"[^>]*multiple/);
  assert.match(source, /accept="[^\"]*\.pdf[^\"]*\.jpg[^\"]*\.png[^\"]*\.zip/i);
  assert.match(source, /form\.append\("ticket", JSON\.stringify\(ticket\)\)/);
  assert.match(source, /form\.append\("attachments", file\)/);
  assert.match(source, /uploadToSignedUrl/);
  assert.match(source, /ticket-attachments\/upload-intent/);
  assert.doesNotMatch(source, /Attachment placeholder:/);
});

test("attachment download and cleanup routes enforce active-account and cron authorization", async () => {
  const [serverSource, vercelSource] = await Promise.all([
    readFile(new URL("../src/server/server.js", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8")
  ]);

  assert.match(serverSource, /ticket-attachments\/:id\/download", requireApprovedUser/);
  assert.match(serverSource, /cron\/ticket-attachments\/cleanup", requireCronSecret/);
  assert.match(vercelSource, /api\/cron\/ticket-attachments\/cleanup/);
});

test("ticket attachment migration creates a private bucket and protected metadata table", async () => {
  const migrationNames = await readdir(new URL("../supabase/migrations", import.meta.url));
  const migrationName = migrationNames.find((name) => name.endsWith("_ticket_attachments.sql"));
  assert.ok(migrationName, "ticket attachment migration is missing");
  const sql = await readFile(new URL(`../supabase/migrations/${migrationName}`, import.meta.url), "utf8");

  assert.match(sql, /create table (?:if not exists )?public\.ticket_attachments/i);
  assert.match(sql, /insert into storage\.buckets/i);
  assert.match(sql, /public[^;]*false/i);
  assert.match(sql, /alter table public\.ticket_attachments enable row level security/i);
  assert.match(sql, /revoke all on table public\.ticket_attachments from anon, authenticated/i);
  assert.match(sql, /ticket_attachments_uploaded_by_idx/i);
});

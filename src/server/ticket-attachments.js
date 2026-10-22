import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export const maxTicketAttachments = 5;
export const maxTicketAttachmentBytes = 10 * 1024 * 1024;
export const ticketAttachmentBucket = "ticket-attachments";

const allowedTypes = new Map([
  [".pdf", new Set(["application/pdf"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".png", new Set(["image/png"])],
  [".zip", new Set(["application/zip", "application/x-zip-compressed", "application/octet-stream"])]
]);

export function validateTicketAttachments(files = []) {
  if (files.length > maxTicketAttachments) {
    return { valid: false, error: `Attach up to ${maxTicketAttachments} files per ticket.` };
  }
  for (const file of files) {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    if (!allowedTypes.get(extension)?.has(String(file.mimetype || "").toLowerCase())) {
      return { valid: false, error: "Attachments must be PDF, JPG, PNG, or ZIP files." };
    }
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return { valid: false, error: `${file.originalname || "Attachment"} is empty.` };
    }
    if (file.size > maxTicketAttachmentBytes) {
      return { valid: false, error: `${file.originalname || "Attachment"} exceeds the 10 MB limit.` };
    }
  }
  return { valid: true };
}

export function validateTicketAttachmentContents(files = []) {
  for (const file of files) {
    const extension = path.extname(String(file.originalname || "")).toLowerCase();
    const bytes = Buffer.from(file.buffer || []);
    const valid = extension === ".pdf"
      ? bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))
      : extension === ".jpg" || extension === ".jpeg"
        ? bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
        : extension === ".png"
          ? bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
          : extension === ".zip"
            ? ["504b0304", "504b0506", "504b0708"].includes(bytes.subarray(0, 4).toString("hex"))
            : false;
    if (!valid) return { valid: false, error: `${file.originalname || "Attachment"} content does not match its file type.` };
  }
  return { valid: true };
}

export function canAccessTicketAttachment(profile, ticket) {
  if (!profile || !ticket || ticket.deletedAt) return false;
  return profile.role === "admin" || Boolean(ticket.requesterUserId && ticket.requesterUserId === profile.id);
}

export function createTicketAttachmentClaim(attachment, secret) {
  return createHmac("sha256", secret).update(claimPayload(attachment)).digest("base64url");
}

export function verifyTicketAttachmentClaim(input, secret, now = new Date()) {
  const attachment = {
    originalName: String(input?.originalName || ""),
    storagePath: String(input?.storagePath || ""),
    contentType: String(input?.contentType || ""),
    sizeBytes: Number(input?.sizeBytes),
    createdAt: String(input?.createdAt || "")
  };
  const validation = validateTicketAttachments([{
    originalname: attachment.originalName,
    mimetype: attachment.contentType,
    size: attachment.sizeBytes
  }]);
  const createdAt = Date.parse(attachment.createdAt);
  const ageMs = now.getTime() - createdAt;
  if (!validation.valid || !attachment.storagePath.startsWith("pending/") || !Number.isFinite(createdAt) || ageMs < -60_000 || ageMs > 15 * 60_000) {
    return { valid: false, error: "Attachment upload authorization is invalid or expired." };
  }
  const expected = Buffer.from(createTicketAttachmentClaim(attachment, secret));
  const actual = Buffer.from(String(input?.claim || ""));
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return { valid: false, error: "Attachment upload authorization is invalid or expired." };
  }
  return { valid: true, attachment };
}

export function createUploadIntentLimiter({ limit = 20, windowMs = 15 * 60_000 } = {}) {
  const requests = new Map();
  return {
    allow(key, now = new Date()) {
      const cutoff = now.getTime() - windowMs;
      const recent = (requests.get(key) || []).filter((timestamp) => timestamp > cutoff);
      if (recent.length >= limit) return false;
      recent.push(now.getTime());
      requests.set(key, recent);
      return true;
    }
  };
}

export function createTicketAttachmentStorage({ supabase = null, localDir = "" } = {}) {
  async function createUploadIntent(file) {
    if (!supabase) return null;
    const safeName = sanitizeFilename(file.originalname);
    const storagePath = `pending/${randomUUID()}-${safeName}`;
    const { data, error } = await supabase.storage.from(ticketAttachmentBucket).createSignedUploadUrl(storagePath);
    if (error) throw error;
    return { storagePath, uploadToken: data.token };
  }

  async function save(ticketRecordId, files = []) {
    const saved = [];
    try {
      for (const file of files) {
        const safeName = sanitizeFilename(file.originalname);
        const storagePath = `${ticketRecordId}/${randomUUID()}-${safeName}`;
        if (supabase) {
          const { error } = await supabase.storage
            .from(ticketAttachmentBucket)
            .upload(storagePath, file.buffer, { contentType: file.mimetype, upsert: false });
          if (error) throw error;
        } else {
          const absolutePath = path.join(localDir, storagePath);
          await mkdir(path.dirname(absolutePath), { recursive: true });
          await writeFile(absolutePath, file.buffer);
        }
        saved.push({
          id: randomUUID(),
          originalName: file.originalname,
          storagePath,
          contentType: file.mimetype,
          sizeBytes: file.size,
          createdAt: new Date().toISOString()
        });
      }
      return saved;
    } catch (error) {
      await remove(saved.map((item) => item.storagePath));
      throw error;
    }
  }

  async function remove(storagePaths = []) {
    if (!storagePaths.length) return;
    if (supabase) {
      const { error } = await supabase.storage.from(ticketAttachmentBucket).remove(storagePaths);
      if (error) throw error;
      return;
    }
    const { rm } = await import("node:fs/promises");
    await Promise.all(storagePaths.map((storagePath) => rm(path.join(localDir, storagePath), { force: true })));
  }

  async function createDownloadUrl(attachment) {
    if (supabase) {
      const { data, error } = await supabase.storage
        .from(ticketAttachmentBucket)
        .createSignedUrl(attachment.storagePath, 60, { download: attachment.originalName });
      if (error) throw error;
      return data.signedUrl;
    }
    const data = await readFile(path.join(localDir, attachment.storagePath));
    return `data:${attachment.contentType};base64,${data.toString("base64")}`;
  }

  async function verifyStoredAttachment(attachment) {
    if (!supabase) return { valid: true };
    const { data, error } = await supabase.storage.from(ticketAttachmentBucket).download(attachment.storagePath);
    if (error || !data) throw new Error(`Unable to verify ${attachment.originalName}. Please upload it again.`);
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length !== attachment.sizeBytes) throw new Error(`${attachment.originalName} did not upload completely.`);
    const contentValidation = validateTicketAttachmentContents([{ originalname: attachment.originalName, buffer }]);
    if (!contentValidation.valid) throw new Error(contentValidation.error);
    return { valid: true };
  }

  async function cleanupPending({ referencedPaths = [], now = new Date(), olderThanMs = 2 * 60 * 60_000 } = {}) {
    if (!supabase) return { removed: 0 };
    const referenced = new Set(referencedPaths);
    const cutoff = now.getTime() - olderThanMs;
    const removable = [];
    let offset = 0;
    while (true) {
      const { data, error } = await supabase.storage.from(ticketAttachmentBucket).list("pending", {
        limit: 1000,
        offset,
        sortBy: { column: "created_at", order: "asc" }
      });
      if (error) throw error;
      for (const item of data || []) {
        const storagePath = `pending/${item.name}`;
        const createdAt = Date.parse(item.created_at || item.createdAt || "");
        if (!referenced.has(storagePath) && Number.isFinite(createdAt) && createdAt < cutoff) removable.push(storagePath);
      }
      if (!data || data.length < 1000) break;
      offset += data.length;
    }
    for (let index = 0; index < removable.length; index += 100) {
      await remove(removable.slice(index, index + 100));
    }
    return { removed: removable.length };
  }

  return { createUploadIntent, save, remove, createDownloadUrl, verifyStoredAttachment, cleanupPending };
}

function claimPayload(attachment) {
  return [
    attachment.originalName,
    attachment.storagePath,
    attachment.contentType,
    attachment.sizeBytes,
    attachment.createdAt
  ].join("\n");
}

function sanitizeFilename(filename) {
  const extension = path.extname(filename).toLowerCase();
  const base = path.basename(filename, extension)
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return `${base || "attachment"}${extension}`;
}

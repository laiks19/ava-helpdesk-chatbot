create index if not exists ticket_attachments_uploaded_by_idx
on public.ticket_attachments (uploaded_by)
where uploaded_by is not null;

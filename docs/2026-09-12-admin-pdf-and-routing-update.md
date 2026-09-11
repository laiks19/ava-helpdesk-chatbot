# Ava Admin PDF And Routing Update

## What Changed

- Added Admin controls to remove uploaded PDF files from Ava's library.
- Added a server API that deletes PDF records locally or from Supabase Storage and metadata.
- Updated Ava's icon from CSS blocks to an accessible SVG robot icon.
- Changed the default OpenAI fallback model to `gpt-4o` for more accurate answers.
- Added IT-support scope checking before PDF search or OpenAI fallback.
- Added repeated-question escalation after the same user question appears more than 5 times.

## Decisions

- Ava checks local support routing before AI calls so non-IT questions are rejected politely and do not spend API usage.
- Ava still searches uploaded PDFs before using OpenAI to keep the knowledge base authoritative.
- PDF deletion is handled through the Admin page because PDF library changes should stay behind Admin login.
- The WhatsApp escalation uses `https://wa.me/60122247105` because browsers cannot reliably detect whether WhatsApp is already open.

## Follow-Up

- Add embeddings for stronger semantic PDF retrieval.
- Replace the simple Admin password with a production authentication provider.
- Add upload audit history for Admin library changes.

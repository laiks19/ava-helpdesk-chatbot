# Ava Follow-Up Context Routing

## What Changed

- Ava now treats unresolved follow-up messages as part of the previous IT support issue.
- Phrases like `try all, still same`, `not solved`, and `still cannot` use the recent conversation before deciding whether the message is IT-related.
- OpenAI fallback now receives the previous IT topic together with the follow-up message, so it can answer the continuing support case.

## Why

The earlier topic check looked only at the latest user message. Short follow-ups often do not repeat words like printer, VPN, software, or password, so valid IT conversations could be rejected by mistake.

## Decision

Keep the non-IT rejection, but classify unresolved follow-ups with recent chat context. This improves accuracy without allowing unrelated new topics through.

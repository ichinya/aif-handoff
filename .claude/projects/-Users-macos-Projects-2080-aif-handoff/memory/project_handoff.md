---
name: AIF Handoff project overview
description: Commercial product - autonomous task management with Kanban + AI subagents via Claude Agent SDK. SQLite storage, cron-based agent polling, web UI.
type: project
---

AIF Handoff — autonomous task management system where tasks flow through Kanban stages, each handled by Claude Agent SDK subagents.

**Why:** Commercial product for sale — UI polish and quality are critical.

**How to apply:** Always prioritize UX quality, treat this as a production SaaS product. Task granularity follows aif-plan conventions (one task can be a feature, bug fix, or full PR depending on scope).

Key decisions (2026-03-26):
- Storage: SQLite
- Agent trigger: cron (polling)
- UI: Web interface, must be beautiful and sellable
- Task scope: flexible, like aif-plan

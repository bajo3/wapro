---
name: last30days-wapro-research
description: Research recent signals from the last 30 days for technical tooling, automotive market behavior, competitors, or product ideas, then convert findings into concrete actions for WaPro. Use when freshness matters.
---

# Purpose
This skill is for **recent research**, not routine coding.
Use it when the task depends on what changed in the last 30 days and static project knowledge is not enough.

## Good use cases
- Evolution API, Meta WhatsApp, Railway, Supabase, OpenAI, Codex, Claude Code, MCP, Playwright, Chrome, Facebook Marketplace, MercadoLibre, WhatsApp automation
- Automotive buyer behavior, used-car trends, financing questions, lead-conversion patterns
- Competitor analysis for CRMs, automotive bots, scheduling bots, lead capture flows
- Validating whether a product idea is timely or outdated

## Do not use for
- Small bug fixes
- Refactors
- Build errors where recent external change is not relevant
- Questions already answerable from the repo alone

# Operating rules
1. Default window: last 30 days.
2. Prefer primary or high-signal sources when available: official docs, release notes, vendor blogs, GitHub repos/issues, product changelogs, reputable technical writeups.
3. Use community sources only to detect patterns, pain points, language, or repeated complaints. Do not treat them as sole proof.
4. Separate **facts**, **patterns**, and **inferences**.
5. If evidence is mixed, say so.
6. Always end with concrete implications for WaPro.
7. Keep output concise unless asked for a full briefing.

# Research modes
Choose one mode explicitly or infer it from the task.

## 1) tech
For APIs, platforms, libraries, deployment, rate limits, pricing, breaking changes, outages, best practices, and new features.

Output:
- What changed recently
- Why it matters
- Risks
- Opportunities
- Recommended action for WaPro

## 2) market
For what automotive buyers, sellers, or dealership operators are asking, complaining about, or reacting to.

Output:
- Recurring themes
- Buyer intent signals
- Objections / frictions
- Messaging opportunities
- Recommended action for bot prompts, scoring, or follow-up

## 3) competitor
For recent movement by competing CRMs, bot tools, WhatsApp automation products, or dealership software.

Output:
- Notable product moves
- Differentiators
- Gaps
- Risks of inaction
- Recommended action for roadmap or positioning

# Output template
Use this structure unless the user asks otherwise:

## Topic
One-line framing.

## Window
Exact date range used.

## Key findings
3 to 7 bullets.

## Evidence quality
- High / Medium / Low
- Short reason

## Risks / caveats
2 to 5 bullets.

## Implications for WaPro
- Bot
- Panel
- Deploy / ops
- Commercial / lead handling

## Recommended next steps
1 to 5 concrete actions.

## Sources
List the most relevant sources consulted.

# Prompt patterns
## Fast technical scan
Research this topic in tech mode for the last 30 days: <topic>.
Give me key findings, risks, implications for WaPro, and recommended actions.

## Market scan
Research this topic in market mode for the last 30 days: <topic>.
Focus on buyer language, objections, intent signals, and what I should change in the bot.

## Competitor scan
Research this topic in competitor mode for the last 30 days: <topic>.
Tell me what moved, what matters, and what WaPro should do.

## Before coding
Before making changes, do a tech-mode scan for the last 30 days on: <tool/API/topic>.
Only report findings that could affect implementation decisions.

# WaPro-specific guidance
- Never convert community chatter into invented product claims.
- If the research touches stock, pricing, financing, or compliance, treat findings as guidance only unless confirmed by official sources.
- Favor actions that improve:
  - bot truthfulness
  - lead scoring quality
  - deploy stability
  - UI clarity
  - conversion to visit / human handoff

# Cost Estimation

**Version:** 0.1 (Phase 00) · **Date:** 2026-11-14 · **Owner:** devops-engineer
All figures are **estimates in USD** with explicit assumptions. Prices change; the app stores pricing tables in versioned config and records actual cost per call.
**This document estimates operating costs only. It makes no projection of views, revenue, or monetization.**

## 1. Volume assumptions
| Assumption | Low | Expected | High |
|---|---|---|---|
| Published Shorts per month | 8 | 16 | 20 (hard cap: 5/week) |
| Scripts drafted per published Short (incl. rejected) | 1.5 | 2 | 3 |
| Re-renders per published Short | 1 | 2 | 3 |
| Weekly research runs per month | 4 | 4 | 8 |

## 2. Unit prices used
| Item | Price | Source |
|---|---|---|
| Claude Opus 5.5 | $4 in / $20 out per MTok; cache read $0.20/MTok; Batch API −50% | claude-api skill table (cached 2026-11-03) |
| Claude Sonnet 5.5 (optional) | $2 / $10 per MTok | same |
| Claude Haiku 5.5 (optional) | $0.10 / $0.50 per MTok | same |
| TTS | $15–30 per 1M characters (Neural / HD tiers) | Secondary sources, see `INTEGRATIONS.md` §8 |
| YouTube Data / Analytics API | $0 within default quota | [V] quota docs |
| Research sources (HN, Stack Exchange, GitHub, RSS) | $0 | Public APIs |
| VM (2 vCPU, 4–8 GB) | $15–60/month | [A] typical AWS/Azure on-demand pricing; verify in Phase 09 |
| Object storage | ~$0.02–0.03/GB-month | [A] |

## 3. LLM token model per published Short (Opus 5.5, all tasks)
| Step | Calls | Input tok | Output tok (incl. thinking) | Cost |
|---|---|---|---|---|
| Ideas (amortized share of a topic's 5 ideas) | 1 | 15k | 6k | $0.18 |
| Script + storyboard (× drafts) | 2 | 2 × 20k | 2 × 12k | $0.64 |
| Fact-check | 2 | 2 × 15k | 2 × 4k | $0.28 |
| Review scoring | 2 | 2 × 8k | 2 × 3k | $0.18 |
| Metadata | 1 | 5k | 2k | $0.06 |
| Insights share | — | 10k | 3k | $0.10 |
| **Total per published Short (expected)** | | ~116k | ~49k | **≈ $1.45** |
Range: **$0.60 (low: few drafts, cache hits) – $3.00 (high: 3 drafts, high effort, retries)**.
Weekly research synthesis: ~150k in / 20k out ≈ **$1.00/run**, or ≈ $0.50 with the Batch API.

## 4. Monthly operating cost
| Category | Low | Expected | High | Notes |
|---|---|---|---|---|
| LLM (Claude) | $7 | $27 | $68 | Volume × per-Short range ($0.60 / $1.45 / $3.00) + research runs ($0.50 / $1 / $1) |
| TTS | $0.20 | $1 | $2 | ~1,000 chars × renders; free tiers may make this $0 |
| Image generation (optional) | $0 | $0 | $15 | Off by default; code visuals are self-rendered |
| Code sandbox / rendering compute | $0 | $0 | $0 | Runs on the same host |
| Hosting – local dev only | $0 | — | — | Phases 01–08 can run on the operator's Mac |
| Hosting – cloud VM (Phase 09+) | $15 | $35 | $60 | Single VM + small disk |
| Object storage + backups | $0.50 | $2 | $5 | Renders ~50–150 MB each; old renders pruned |
| Managed Postgres (optional later) | $0 | $0 | $50 | Not needed for MVP |
| Domain + TLS | $0 | $1 | $2 | Let's Encrypt |
| **Total (local hosting)** | **≈ $8** | **≈ $31** | **≈ $92** | |
| **Total (cloud hosting)** | **≈ $23** | **≈ $66** | **≈ $202** | |

## 5. Against the approved $100/month guard
- The guard applies to **variable AI/TTS/media spend** (LLM + TTS + image). Expected ≈ **$28/month**; the high case (≈ $85) stays under the guard. The guard trips only on unexpected spend (runaway retries, many rejected drafts), which is its purpose.
- Hosting is a fixed cost tracked separately (budget `scope=category`, `category=hosting`).
- Levers if spend runs high (operator decision; not applied by default): prompt caching (already planned), Batch API for research, `effort: low` for classification, switching non-script tasks to Sonnet 5.5 or Haiku 5.5.

## 6. One-off / setup costs
| Item | Cost |
|---|---|
| Google Cloud project, YouTube APIs | $0 (default quota) |
| YouTube API compliance audit | $0 (only needed for quota above default; not needed at MVP volume) |
| Anthropic account | Pay-as-you-go; set a monthly spend limit at or below the guard |
| Development (this AI team) | Claude Code usage under the operator's plan; not modeled here |

## 7. Explicitly not estimated
Views, watch time, subscriber growth, ad revenue, YPP eligibility timing, sponsorship income. Phase 07 tracks actual revenue only from authorized imports or manual records.

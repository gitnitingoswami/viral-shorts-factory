# External Integrations

**Version:** 0.1 (Phase 00) · **Research date:** 2026-11-14 · **Owners:** Lead Orchestrator, security-reviewer

Legend: **[V]** verified on the official source on 2026-11-14 · **[S]** secondary source only, re-verify before relying on it · **[A]** assumption.
All provider facts must be re-verified at the start of the phase that implements them, because platform APIs change often (several YouTube changes landed in Nov 2026 alone).

## 1. Summary matrix
| Service | Used for | Phase | Access model | Status |
|---|---|---|---|---|
| YouTube Data API v3 | Research (search, video stats), upload, metadata, thumbnails | 02, 05, 06 | Google OAuth 2.0 + API key | Needs GCP project |
| YouTube Analytics API | Channel/video metrics, optional revenue | 06 | Google OAuth 2.0 | Needs GCP project |
| Google Trends API (alpha) | Search interest signals | 02 (optional) | Application-only alpha | Apply; not on critical path |
| Hacker News API | Developer trend signals | 02 | Public, no auth | Ready |
| Stack Exchange API | Question trends by tag | 02 | Public; optional app key | Ready |
| GitHub REST API | Trending repos (search by stars and creation date) | 02 | Token (fine-grained, read-only public) | Needs token |
| Dev.to / RSS feeds | Article trends, release notes | 02 | Public RSS/API | Ready |
| Anthropic Claude API | Ideas, scripts, fact-check, insights | 02–08 | API key | Needs key |
| TTS provider | Narration | 04 | API key / cloud credential | Choose in Phase 04 |
| Image/video generation (optional) | Backgrounds / title cards | 04 | API key | Optional |
| Gmail API | Operator notifications (optional) | 08 | Google OAuth `gmail.send` | Optional |
| Object storage (S3 / Azure Blob / MinIO) | Media assets and renders | 01, 04 | Cloud IAM / local | MinIO locally |
| GitHub (repo hosting) | Source control, CI | 00+ | HTTPS keychain credential | Ready |

## 2. YouTube Data API v3
Sources: [videos.insert](https://developers.google.com/youtube/v3/docs/videos/insert), [videos resource](https://developers.google.com/youtube/v3/docs/videos), [revision history](https://developers.google.com/youtube/v3/revision_history), [quota calculator](https://developers.google.com/youtube/data/determine_quota_cost).

### Verified facts
- **[V] Granular quota (since 2026-06-01):** `videos.insert` and `search.list` each have their own quota bucket; all other methods share the general bucket (default 10,000 units/day).
- **[V]** `videos.insert` costs **1 unit in the Video Uploads bucket**. **[S]** The default allocation is about 100 uploads/day and 100 `search.list` calls/day (overview page and calculator). Check the actual project limits in the Cloud Console.
- **[V]** Getting more than the default quota requires the YouTube API Services compliance audit and the quota extension form.
- **[V] 2026-11-02:** uploads from **unverified API projects are no longer locked to private**.
- **[V] `privacyStatus` defaults to `public` if omitted** on insert. **The system must always set it explicitly** (default `private`).
- **[V]** `status.publishAt` (scheduling) can only be set when `privacyStatus=private` and the video has never been published. A past time publishes immediately.
- **[V]** `status.containsSyntheticMedia` (since 2024-10-30) discloses realistic altered/synthetic content. It is settable on insert/update.
- **[V]** `status.selfDeclaredMadeForKids` is settable. We always send `false` explicitly (the audience is developers).
- **[V]** `status.uploadStatus` ∈ {`uploaded`, `processed`, `failed`, `rejected`, `deleted`}. Used for remote-state verification.
- **[V]** Upload scopes accepted: `youtube.upload`, `youtube`, `youtubepartner`, `youtube.force-ssl`. Max file 256 GB; MIME `video/*`.
- **[V] 2026-11-03:** `thumbnails.set` supports custom Shorts thumbnails after processing (`shortsAspectRatio`).
- **[V] 2025-07-21:** the `mostPopular` chart now draws only from Music, Movies, and Gaming trending charts, so it is **not useful for coding trends**.
- **[V] Shorts definition:** square or vertical video up to **3 minutes** ([help](https://support.google.com/youtube/answer/15424877)). There is no API flag for "Short"; classification is by YouTube.

### Least-privilege scopes
| Phase | Scope | Why |
|---|---|---|
| 02/06 | `https://www.googleapis.com/auth/youtube.readonly` | Read own channel/video details |
| 06 | `https://www.googleapis.com/auth/yt-analytics.readonly` | Analytics reports |
| 07 (optional) | `https://www.googleapis.com/auth/yt-analytics-monetary.readonly` | Estimated revenue. Only if YPP and the operator opts in |
| 05 | `https://www.googleapis.com/auth/youtube.upload` | Upload only. **Not** the broad `youtube` scope |
| 05 | `https://www.googleapis.com/auth/youtube.readonly` (already granted in 02) | Upload-state verification and duplicate reconciliation via the uploads playlist |
| 05 (optional) | `https://www.googleapis.com/auth/youtube.force-ssl` | Only if caption upload or metadata update after upload is needed; decide in Phase 05 |

Public research calls (`search.list`, `videos.list` for public videos) use an **API key**, not user OAuth.
Scopes are requested incrementally per phase (Google incremental authorization).

### Quota budget (MVP)
Weekly research: up to ~50 `search.list` calls (own bucket) + ~100 units of `videos.list` in the general bucket.
Uploads: ≤ 5/week (≤ 20/month). Analytics refresh: a few hundred units/day at most. **Well inside defaults [A].**

## 3. YouTube Analytics API
Source: [reference](https://developers.google.com/youtube/analytics/reference).
- **[V]** Scopes: `yt-analytics.readonly` (activity metrics); `yt-analytics-monetary.readonly` (adds estimated revenue and ad metrics).
- **[V] 2026-08-27:** public view counting is aligned across formats (a view counts from the first frame). Monetization and core metrics use "engaged views".
- **[A]** Analytics data is delayed (typically 24–72 h). Phase 06 must label metric freshness and never treat delayed zeros as real zeros.

## 4. Google Trends API (alpha)
- **[V]** Announced 2025-07-24 as an alpha; access is by application ([Google](https://developers.google.com/search/apis/trends)).
- **[S]** A small pilot group; no public pricing; 5-year rolling window.
- **Decision:** apply for access, but **do not depend on it**. The community `pytrends` scraper is excluded (unofficial, archived, against our no-scraping rule).

## 5. Developer-trend sources (coding niche)
| Source | Access | Terms note | Signals |
|---|---|---|---|
| Hacker News search (Algolia `hn.algolia.com/api/v1`) | Public, no auth | [A] Permissive; respect rate limits. Used instead of the Firebase API: one query per keyword instead of hundreds of item fetches | Stories in the window, points, comments |
| Stack Exchange API v2.3 | Public; app key raises quota | [A] Attribution (CC BY-SA) required for content reuse; we use metadata only | Tag activity, question velocity |
| GitHub REST search | Token; 30 search req/min authenticated [S] | [A] API terms allow this use | New repos by stars, topic growth |
| Dev.to API / RSS, official release-note feeds (Node, TypeScript, Angular) | Public | [A] Use headlines/links only; don't republish text | Release and topic timing |
| YouTube `search.list` | API key | [V] Own quota bucket | Competing Shorts per topic, recency |
**Excluded:** Reddit (paid API terms; revisit later), X/Twitter (paid), any HTML scraping.
Phase 02 must re-verify each source's terms and record the result in the source registry.

## 6. YouTube content policies that shape the product
- **[V] Inauthentic content** (renamed from "repetitious", 2025-07-15): excludes "mass-produced, generic, repetitive, or manipulative" content and "AI-generated content made with generic or unoriginal templates giving the impression of mass production". Automated tools are allowed if "the final product must still demonstrate your creative vision" ([policy](https://support.google.com/youtube/answer/1311392)).
- **[V] Reused content:** policy violations apply channel-wide.
- **[V] YPP eligibility:** 1,000 subscribers + 4,000 watch hours/12 months **or** 10M Shorts views/90 days; updated terms take effect **2027-02-01** ([help](https://support.google.com/youtube/answer/72851)). Secondary sources report higher 2027 thresholds; these are **unconfirmed on official pages, so the product does not rely on them**. Re-check in Phase 07.
- **[V] Synthetic content disclosure:** disclosure is required for *realistic* altered/synthetic content. A synthetic TTS voice narrating code tips is likely not "realistic depiction" content **[A]**. **Default policy: set `containsSyntheticMedia=true` whenever an AI voice or AI-generated imagery is used.** This is conservative; per Google's help page, disclosure does not limit reach or monetization.

## 6a. Regional, account and data restrictions
- **[A] Channel requirements:** custom thumbnails and some features need a phone-verified channel (intermediate/advanced features). The operator should verify @Codehaksy in YouTube Studio before Phase 05.
- **[V] YPP availability is country-dependent** (the help page lists eligible regions). The operator's country must be eligible before monetization tracking matters (Phase 07).
- **[A] Google OAuth consent screen:** while the app is in **"Testing"** status (External), refresh tokens **expire after 7 days**, which breaks scheduled analytics/uploads. Options: move to "In production" (sensitive scopes like `youtube.upload` may then need Google verification), or accept weekly re-authorization during development. Decide in Phase 05.
- **[A] YouTube API Services Developer Policies:** API data about other channels must be refreshed or deleted within 30 days. Research storage follows this (`DATABASE_DESIGN.md` §6). Re-verify in Phase 02.
- **[A] Anthropic API:** available only in supported countries; the operator's account region must be supported. Data retention follows the account's terms.
- **[A] TTS providers:** voice availability and commercial-use rights vary by region and plan; record the license per voice in `voice_profile`.
- **[A] Google Trends alpha:** access is limited to approved testers.

## 7. Anthropic Claude API
Source: the claude-api skill model table (cached 2026-11-03); re-check [pricing](https://platform.claude.com/docs/en/about-claude/pricing) in Phase 03.
| Model | ID | Input $/MTok | Output $/MTok | Use |
|---|---|---|---|---|
| Claude Opus 5.5 | `claude-opus-5-5` | 4.00 | 20.00 | **Default for all generation** (ideas, scripts, fact-check, insights) |
| Claude Sonnet 5.5 | `claude-sonnet-5-5` | 2.00 | 10.00 | Operator-selectable cheaper option |
| Claude Haiku 5.5 | `claude-haiku-5-5` | 0.10 | 0.50 | Operator-selectable for bulk classification/dedup |
Notes: Opus 5.5 thinking cannot be disabled; control cost with `output_config.effort` (default `medium`). Forced `tool_choice` returns 400, so use structured outputs. Prompt caching and the Batch API (50% off) are available for weekly research.

## 8. Text-to-speech (choose in Phase 04)
| Provider | Price per 1M chars | Source | Notes |
|---|---|---|---|
| Google Cloud TTS Neural2 / Chirp 3 HD | ~$16 / ~$30 (free tier 1M/mo for Chirp HD) | [S] | Same GCP project as YouTube |
| Azure AI Speech Neural / HD | ~$15–16 / ~$22 (500K free/mo) | [S] | Good SSML control |
| OpenAI tts-1 / tts-1-hd | $15 / $30 | [S] | Simple API |
| ElevenLabs | ~$50–100 | [S] | Highest naturalness, highest cost |
A 60-second Short is ~800–1,000 characters, so TTS cost is **< $0.10/video at any provider**. Choose on quality and license terms (commercial use of the output must be allowed), not price.

## 9. Gmail (optional, Phase 08)
- Scope: `https://www.googleapis.com/auth/gmail.send` only, to send notifications to the operator's own address. No read scope.
- Alternative with no extra OAuth: in-app notifications + optional webhook. **Recommended default.**

## 10. GitHub (source control)
- Repo: `gitnitingoswami/viral-shorts-factory` (private; created 2026-11-14).
- Access: HTTPS via the macOS keychain credential set up by VS Code (scopes `repo`, `workflow`). `gh` CLI is still unusable (`~/.config/gh` root-owned); the GitHub REST API is used instead.
- CI (Phase 01): GitHub Actions with no secrets needed for unit tests. Provider integrations are mocked in CI.

## 11. Credential and setup checklist (user actions)
| # | Item | Needed by | How |
|---|---|---|---|
| 1 | GitHub push access | Done | Working via VS Code keychain credential |
| 2 | Docker Desktop running | Phase 01 | Start the app |
| 3 | GCP project, YouTube Data API v3 + YouTube Analytics API enabled, OAuth consent screen (External/Testing, operator as test user; note the 7-day refresh-token expiry in Testing, §6a), OAuth client (Web), API key restricted to YouTube Data API | Phase 02 | Google Cloud Console |
| 4 | Anthropic API key with a monthly spend limit | Phase 03 | console.anthropic.com → put it in `.env` locally |
| 5 | TTS provider credential | Phase 04 | After choosing in Phase 04 |
| 6 | GitHub fine-grained read-only token for the GitHub search source | Phase 02 | Optional; unauthenticated works at a lower rate |
| 7 | (Optional) Google Trends alpha application | Phase 02 | developers.google.com/search/apis/trends |
Secrets live only in `.env` (git-ignored) locally and in the cloud secret manager in production. Never in chat, docs, or Git.

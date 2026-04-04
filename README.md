# EVA Roadmap (Emotionally Aware Virtual Assistant)

EVA is being built on Next.js (App Router), not plain React SPA. This gives you one codebase for UI, API routes, server logic, and deployment.

## Changelog

Template for future entries:

```md
### YYYY-MM-DD

- Completed:
	- ...
- Changed:
	- ...
- Fixed:
	- ...
- Next:
	- ...
```

### 2026-03-22

- Completed Step 1: introduced Vitest baseline and API tests for chat/memory routes.
- Completed Step 2: added context continuity guardrail to prevent stateless responses when context exists.
- Completed Step 3: added emotion confidence scoring and tone strategy mapping with structured persistence.
- Completed Step 4: shipped voice loop v1 (browser STT/TTS, interrupt support, voice/chat event bridge).
- Added memory debugging tooling:
	- `GET /api/memory` endpoint (non-production)
	- in-app Memory Debug panel
	- copy/download debug snapshot
- Added memory quality upgrades:
	- relevance-ranked memory retrieval
	- periodic conversation summary memory
	- preference extraction pipeline (likes/dislikes/topics)
- Added context telemetry in chat responses/logs (`historyCount`, `memoryUsed`, `providerUsed`, etc.).

### 2026-03-23

- Changed voice UX to draft-first mode: STT fills editable chat input and user clicks Send manually (no auto-send).
- Improved Chrome STT capture by accumulating interim/final transcript segments before flush.
- Added free-first runtime policy in UI: server STT fallback is opt-in and disabled by default.
- Added clearer STT guidance/error messages and safer fallback behavior.

### 2026-03-27

- Completed server TTS fallback implementation:
	- added `POST /api/tts` route for server-generated audio playback
	- added Voice mode switch (`Browser TTS` / `Server TTS Fallback`)
	- unified Stop/Interrupt behavior for browser and server playback modes
- Expanded automated tests for TTS route, including success and max-length validation.
- Fixed TypeScript compatibility in voice recognition event typing and OpenAI TTS request options.
- Completed memory intelligence upgrade:
	- selective memory utilization with natural-language formatting and relevance threshold
	- reference trigger system (keyword overlap forces contextual memory references)
	- conversation compression (10→3 recent messages + long-term summary)
	- response quality guardrails (system prompt rules requiring memory references, banning generic replies)
	- new telemetry fields: `triggeredMemoryKeys`, `hasSummaryContext`

### 2026-03-29

- Conversational intelligence upgrade:
	- Golden Rule: EVA picks ONE mode per reply (react / reflect / ask)
	- Emotion-specific conversational hooks in tone strategies
	- Memory-based follow-up hooks with question-spam prevention
	- Anti-pattern bans (interrogation, therapy, generic, survey, cheerleader)

### 2026-03-31

- Completed Phase 3 Structured ML Data Telemetry:
	- Added `TrainingInteraction` Mongoose schema to export clean `(input, predictedEmotion, reply, memoryUsed)` dataset rows.
	- Added `PATCH /api/feedback` endpoint to capture ground truth signals.
	- Upgraded `ChatPanel.tsx` UI to respectfully collect `Does this feel right? 🙂 🙁` and `Helpful? 👍👎` scores.
- Implemented Architecture Stability & Safety Middlewares (`route.ts`):
	- **Response Compressor (`compressAndCleanReply`)**: Truncates LLM over-generation to ~230 chars without breaking sentences, mathematically limits output to 1 question mark, and prevents `[pause]` spamming.
	- **Memory Extraction Cleaner**: Added strict filters to `extractMemoryCandidate` to permanently block garbage text (`< 5` chars, "so much", "you eva", affirmation words) from polluting database ranking.
	- **Dependency Safety Layer**: Explicitly programmed system instruction to handle over-attachment ("I love you", "You comfort me") by keeping EVA grounded and encouraging real-world connections.
- Upgraded Heuristic Emotion Parser (`inferEmotionSignalFromText`):
	- **Nostalgia & Bittersweet Detection**: Boosts `nostalgic` confidence if past-tense framing is mixed with positive/negative signals.
	- **Hard Overrides**: Keywords like "heartbreaking" automatically bypass heuristic thresholds to force a `sad` 0.95 response.
	- **Negativity Bias**: Resolves toxic positivity bugs by letting negative emotion signals outweigh generic positive tags like "anime" or "beautiful".
	- **Curious False-Positive Dampening**: Curiosity ratings plummet if no explicit `?` mark exists in the user's string.
	- **Regex Hotfix**: Enforced word boundaries `\b` to prevent substring triggering (e.g., "made" triggering "mad").

### 2026-04-04

- Completed Initiative Control System (Behavioral Intelligence):
	- Implemented a 10-signal scoring engine ("Should EVA speak?") to proactively initiate conversation based on memory richness and emotional state.
	- Designed 4 initiative types: `emotional_checkin`, `memory_callback`, `casual_ping`, and `silence` (logged suppression).
	- Added anti-creep guardrails: 8-hour cooldowns, ignore detection (-5 penalty for 2+ ignored messages), and quality gates (length truncations, question limits).
	- Integrated feedback loop: user responses patch `InitiativeLog` to boost future proactive engagement, while stale logic handles ignores.
- Completed Emotional Presence Layer (Cognitive Latency):
	- Integrated `presenceEngine` to calculate typing delays scaled by emotion (e.g., sad replies take 1.4x longer to start than neutral).
	- Added sentence-by-sentence text streaming to mimic human pacing and handle `[pause]` markers explicitly returned by the LLM.
	- Hooked a State Machine into `ChatPanel` for interruption handling (instantly flushes streaming text if user begins typing, never talking over them).
	- Upgraded global UI with animated bouncing dots for the "thinking" phase, replacing static text.
	- Fixed page-level auto-scroll bug by scoping auto-scroll purely to the chat history container.
- Completed Personality Engine (Personality DNA):
	- 5-trait system: warmth, directness, playfulness, curiosity, depth — preset defaults with slow adaptive nudging (±0.02 per interaction).
	- `buildPersonalityPrompt()` translates trait weights into consistent behavioral instructions injected into the system prompt.
	- Migrated User model from 4 vague traits (verbosity/curiosityLevel/emotionalDepth/humorLevel) to the 5 new semantically meaningful traits.
- Completed Mood Carryover (Emotional State Persistence):
	- Emotion-specific decay rates: sadness lingers ~7h (0.9^hours), happiness fades in ~2h (0.7^hours), anger ~2.5h (0.75^hours).
	- Mood drift via weighted blending — single "happy" message after hours of sadness won't instantly flip the mood.
	- Mood shift detection — when mood transitions significantly, EVA can acknowledge it (e.g., "You sound a bit lighter today.").
	- New `MoodState` Mongoose model with rolling history of last 10 mood readings.
- Completed Memory Cleanup (Tiered Memory Hygiene):
	- 4-tier classification: CORE (never delete) → PREFERENCE (rarely delete) → CONTEXT (prune after 30d) → NOISE (delete immediately).
	- Importance decay for unused memories (0.03/day, 3x faster for NOISE).
	- Deduplication via token overlap (>80% similarity within same key prefix).
	- Reinforcement: reused memories get +0.5 importance boost.
	- Soft-delete via `deletedAt` field for recoverability. Active memories filtered with `deletedAt: null`.
- Completed Conversation Arc Engine (Session-Aware Phases):
	- 5 session phases: greeting → warmup → engaged → deep → winding_down, with 2h session gap detection.
	- Exponentially weighted emotional momentum (recent emotions count 3x more than older ones).
	- Unified `buildArcPrompt()` combines session phase + momentum + mood carryover into one coherent instruction block.

## Current Status (April 2026)

Completed now:

- Phase 0 foundation is done (shell UI, env strategy, logging, error handling).
- Phase 1 conversation MVP is done (chat route + chat UI + retry/loading + rate limiting).
- Memory persistence is running on MongoDB (users/messages/memory models).
- Chat history retrieval is active via `GET /api/history`.
- Chat provider fallback is active (Gemini primary, OpenRouter fallback).
- Basic emotion tag extraction is active in chat responses.
- Memory retrieval ranking is implemented (top relevant facts selected per request).
- Structured emotion persistence is active in `Message` (`emotionData` + compatibility with `emotion`).
- Periodic per-user conversation summarization is active and stored in `Memory`.
- Preference extraction pipeline is active for likes/dislikes/topics with multi-fact storage.
- Context debug telemetry is active in chat logs and API response (`historyCount`, `memoryUsed`, `providerUsed`, etc.).
- Development memory debug tools are active:
	- `GET /api/memory` debug endpoint (non-production)
	- in-app Memory Debug panel with one-click snapshot export (clipboard + file fallback)

In progress now:

- Browser speech-recognition stability across environments (network/service variability).
- Voice reliability hardening and observability (latency/error tracking per mode/provider).
- Avatar behavior integration with voice + emotion events.

## Memory Intelligence

Status: Implemented on 2026-03-27.

### 1. Selective Memory Utilization

Memory facts are no longer dumped as raw key-value pairs. `buildSmartMemoryContext()` filters by relevance threshold (score ≥ 1.5 or importance ≥ 4) and formats facts as natural-language sentences grouped into Known Facts, User Preferences, and Conversation Summary sections.

### 2. Reference Trigger System

`findTriggeredMemories()` scans the user's message for keyword overlap with stored memory values. Triggered memories are injected with an explicit prompt: *"Directly relevant memory (reference this naturally in your reply)"* — forcing EVA to weave them into the response.

Demo flow:

1. User: "I enjoy cooking"
2. Later: "What should I do this weekend?"
3. EVA: "Since you enjoy cooking, maybe try a new recipe this weekend…"

### 3. Conversation Compression

Short-term context is now the last 3 messages (instead of 10). Long-term context comes from the existing `conversation_summary` memory. This reduces token usage by ~60-70% per request while maintaining context quality.

### 4. Response Quality Guardrails

The system prompt now includes explicit rules:

- MUST weave memories into replies naturally when provided
- NEVER give generic responses when relevant context exists
- NEVER repeat phrasing from recent messages
- If "Directly relevant memory" is provided, MUST reference those items

### 5. Enhanced Telemetry

API response `contextDebug` now includes `triggeredMemoryKeys` and `hasSummaryContext` for debugging memory utilization.

### 6. Production Scoring Algorithm

Memory ranking uses a 4-component composite scorer with normalized sub-scores (0–1):

```
score = 0.5 × relevance + 0.2 × recency + 0.2 × importance + 0.1 × frequency
```

| Component | How it works |
|---|---|
| **Relevance** | Keyword overlap + key/value containment vs current message |
| **Recency** | Exponential decay: `e^(-days/7)` (1-week half-life) |
| **Importance** | `memory.importance / 10`, normalized 0–1 |
| **Frequency** | `memory.accessCount / 10`, capped at 1.0 |

A **diversity filter** limits max 2 memories per category (preference/fact/summary) to prevent top-K from being all the same type.

### 7. Memory Schema

| Field | Type | Purpose |
|---|---|---|
| `type` | `"preference" \| "fact" \| "summary" \| "emotion"` | Category for diversity filter |
| `accessCount` | Number | Retrieval frequency tracking |
| `createdAt` | Date | Memory lifecycle |

Access stats: `accessCount` is incremented, `lastAccessed` is updated on every retrieval.

## Conversational Intelligence

Status: Implemented on 2026-03-29.

### Golden Rule

Every EVA reply uses exactly ONE mode:
- **React** — share an observation or opinion, no question
- **Reflect** — connect what they said to something deeper
- **Ask** — one specific, meaningful question

### Anti-Patterns (Explicitly Banned)

| Pattern | What it means |
|---|---|
| Interrogation | Asking multiple questions or asking every reply |
| Therapy mode | Going too deep too fast |
| Generic mode | "That's great!" / "Tell me more!" |
| Survey mode | "What are your hobbies?" |
| Cheerleader | "You're doing amazing!" |

### Emotion-Specific Hooks

Each tone strategy includes contextual question templates. Example:
- Sad → "Do you want to talk about it, or just distract yourself for a bit?"
- Happy → "What made today better than usual?"
- Angry → "What set it off?" (blunt and real)

### Memory-Based Conversational Hooks

`buildMemoryHook()` generates casual follow-up suggestions from stored preferences. Suppressed when:
- User emotion is sad/angry/anxious (let them vent)
- EVA already asked a question in the last reply (prevents question spam)

## Product Goal

Build a virtual assistant that can:

- chat naturally
- remember user context over time
- detect emotion from user text and voice
- speak responses aloud
- display a visual avatar with lip sync and expression

## High-Level Architecture

User
-> Next.js Frontend (chat + mic + avatar)
-> Speech to Text (browser or server)
-> EVA Conversation Engine (API route)
-> Emotion + Memory Layer
-> LLM Response
-> Text to Speech
-> Avatar Lip Sync + Expression

## Recommended Stack (Next.js-first)

### Frontend

- Next.js 16 App Router
- TypeScript
- Tailwind CSS
- Optional: React Three Fiber for advanced 3D avatar

### Backend (inside Next.js)

- Route Handlers in `app/api/*`
- Server actions only where useful
- Optional: separate websocket service only if low-latency streaming is required

### AI + Voice

- LLM: OpenAI API (already installed)
- STT (free MVP): Browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`)
- TTS (free MVP): Browser `speechSynthesis`
- Optional paid upgrades later: OpenAI Whisper / OpenAI TTS / ElevenLabs for higher consistency

### Memory + Data

- MongoDB + Mongoose for users, messages, and memory facts
- Optional: Redis for short-lived session/context cache
- Optional: vector store later for long-term semantic memory

## Project Milestones

### Phase 0: Foundation (Days 1-2)

Deliverables:

- project structure finalized
- environment variables strategy
- basic UI shell with EVA branding
- lint, typecheck, and build passing

Tasks:

1. Create folders for components, lib, services, and api routes.
2. Add `.env.local.example` and define API keys.
3. Replace starter page with EVA landing and chat shell.
4. Add baseline error handling and logging utility.

Definition of done:

- `npm run dev`, `npm run lint`, and `npm run build` all pass.

### Phase 1: Conversation Engine MVP (Days 3-5)

Deliverables:

- text chat works end-to-end
- API route calls LLM and returns response

Tasks:

1. Build `app/api/chat/route.ts` with message validation.
2. Build chat UI with user and assistant bubbles.
3. Add loading, retry, and basic rate limiting.

Definition of done:

- user can send text and receive stable model responses.

### Phase 2: Memory System v1 (Week 2)

Deliverables:

- persistent user profile and conversation history
- memory retrieval injected into prompts

Tasks:

1. Add Mongo/Mongoose models for users, conversations, memory facts.
2. Save each chat turn with metadata (time, sentiment, tags).
3. Retrieve top relevant memory before each LLM call.
4. Add memory guardrails (no sensitive storage by default).

Definition of done:

- EVA references previous user preferences accurately.

### Phase 3 (Current Focus): Companion Context Quality

Goal:

- EVA should feel like a good companion, not a stateless chatbot.

Implementation checklist:

1. Always inject last N chat turns (already partially implemented).
2. Add memory retrieval with relevance scoring, not raw dump.
3. Store emotion separately from message text (structured field).
4. Add conversation summarization for long sessions.
5. Add prompt guardrail: avoid "I have no context" when context exists.
6. Add user preference memory (likes, dislikes, tone preference).

Definition of done:

- EVA naturally references previous messages and stable user preferences.
- Replies are context-aware across multiple sessions for the same user.

### Phase 3: Emotion Detection v1 (Week 3)

Deliverables:

- emotion score per message
- response style changes with detected mood

Tasks:

1. Add sentiment and emotion classification utility.
2. Store emotion labels alongside each message.
3. Add tone strategy map (supportive, neutral, energetic).

Definition of done:

- visibly different assistant tone for tired/sad/excited inputs.

### Phase 4: Voice Loop (Week 4)

Deliverables:

- mic input to text
- assistant response spoken back to user

Tasks:

1. Build FREE MVP first (browser-native):
	- Start/Stop mic using `SpeechRecognition` / `webkitSpeechRecognition`
	- On transcript, fill editable chat input (user confirms with Send)
	- Speak reply with browser `speechSynthesis`
	- Add Stop/Interrupt button using `speechSynthesis.cancel()`
2. Improve reliability while staying free:
	- Add retry handling for STT network/service errors
	- Add typed fallback input when STT fails
	- Add browser capability checks and clear user guidance
3. Add optional server fallback (feature-flagged):
	- `POST /api/stt` for browsers where Web Speech fails
	- keep browser-first path as default for zero-cost usage
4. Add optional paid quality upgrades (later phase):
	- Whisper/OpenAI/ElevenLabs only when product requires better accuracy/voice quality

Definition of done:

- user can complete a full voice loop with the free browser stack (STT draft -> manual send -> TTS), including interruption.

### Phase 4.1: Voice Cost Strategy (Free-first)

Default runtime policy:

1. Use browser-native STT/TTS first (no API cost).
2. Use server STT only as fallback when browser STT is unavailable or unstable.
3. Keep paid providers disabled by default in development and early MVP.

Current implementation note:

1. Server STT fallback exists (`POST /api/stt`) and is opt-in via `NEXT_PUBLIC_ENABLE_SERVER_STT=true`.

When to move to paid providers:

1. Accuracy targets are not met across target devices/browsers.
2. Need consistent multilingual support beyond browser capabilities.
3. Need branded high-quality synthetic voices for production UX.

### Phase 5: Avatar System (Weeks 5-6)

Deliverables:

- visual avatar in UI
- mouth movement synced with speech
- basic emotion expressions

Tasks:

1. Start with Ready Player Me or 2D avatar MVP.
2. Map TTS playback state to mouth-open animation.
3. Map emotion labels to expression presets.
4. Add fallback static avatar for low-end devices.

Definition of done:

- avatar speaks and reflects emotional state in real time.

### Phase 6: Realtime and Quality (Weeks 7-8)

Deliverables:

- reduced latency
- robust error handling and analytics

Tasks:

1. Add streaming responses from API to UI.
2. Add telemetry: latency, STT confidence, TTS failures.
3. Add reconnection strategy for network drops.
4. Add security hardening and abuse limits.

Definition of done:

- response pipeline is stable under normal and poor network conditions.

### Phase 7: Production Launch (Weeks 9-10)

Deliverables:

- production deployment
- test coverage for core flows
- privacy and user controls

Tasks:

1. Deploy to Vercel with environment separation.
2. Add regression tests for chat, memory, emotion, and voice.
3. Add user settings: voice on/off, memory clear, tone preference.
4. Add basic consent and privacy screens.

Definition of done:

- EVA is launch-ready for pilot users.

## Suggested Folder Blueprint

```text
app/
	api/
		chat/route.ts
		history/route.ts
		emotion/route.ts
		memory/route.ts
		stt/route.ts
		tts/route.ts
	page.tsx
	layout.tsx
components/
	chat/
	voice/
	avatar/
lib/
	ai/
	memory/
	emotion/
	audio/
	models/
		User.ts
		Message.ts
		Memory.ts
```

## API Contracts (Initial)

- `POST /api/chat`
	- input: message, userId
	- output: reply, emotion, emotionConfidence, toneStrategy, contextMessages, historyCount, memoryUsed, providerUsed

- `POST /api/emotion`
	- input: text
	- output: label, confidence

- `POST /api/memory`
	- input: userId, message, emotion
	- output: savedFactIds

- `POST /api/stt`
	- input: multipart/form-data audio file (`audio`)
	- output: text

- `GET /api/memory` (debug, non-production)
	- input: userId, limit
	- output: normalized memory facts for inspection

- `POST /api/tts`
	- input: text, voiceId
	- output: audio stream or URL

## KPI Targets

- chat first-token latency: less than 1.5s (streaming)
- voice round-trip latency: less than 3.5s
- memory recall precision in test prompts: more than 80%
- emotion classification agreement on labeled set: more than 75%

## What Was Done In This Sprint

1. Implemented relevance-ranked memory retrieval in chat pipeline.
2. Added structured emotion storage (`emotionData`) while keeping old `emotion` compatibility.
3. Added periodic conversation summaries and persisted them as `conversation_summary` memory.
4. Implemented multi-fact preference extraction for likes, dislikes, and topics.
5. Added context continuity guardrail so EVA avoids stateless replies when context exists.
6. Added emotion confidence scoring and tone-strategy mapping in chat responses.
7. Added context debug telemetry in API response and logs.
8. Added automated test baseline with Vitest for chat and memory routes.
9. Added voice loop v1 in UI:
	- browser STT start/stop controls
	- STT draft-first flow (voice fills input; user edits/sends manually)
	- auto/manual TTS playback
	- stop/interrupt voice playback
	- voice/chat event bridge between panels
	- hydration-safe capability detection
	- retry + fallback UX for mic failures
10. Added developer debugging stack:
	- `GET /api/memory` endpoint
	- in-app Memory Debug panel
	- one-click debug snapshot export (clipboard-first, download fallback)

## Remaining Improvements

1. Improve summary quality (abstractive summarization with conflict handling for old vs new preferences).
2. Improve preference extraction precision (negation edge cases, ambiguity handling, de-dup strategy over time).
3. Add memory privacy controls (sensitive-data filtering + user memory clear/delete tools).
4. Expand automated tests to cover ranking behavior, summary refresh cadence, tone strategy, and voice event flows.
5. Expand voice test coverage for mode-switch interactions and stop/interrupt race conditions.
6. Add production observability (latency/error dashboards and alerting per provider).

## Next Goals (Execution Order)

1. Expand tests for memory ranking, summary cadence, emotion confidence, and voice loop interactions.
2. Add voice interaction regression tests for mode switching and interruption behavior.
3. Add provider/mode telemetry for STT/TTS latency and failure diagnostics.
4. Start avatar-expression mapping from emotion labels and playback events.
5. Add privacy/memory controls in UI (clear memory, consent, and retention settings).
6. Prepare production hardening: abuse limits, reliability metrics, and deployment checklist.

## Server TTS Fallback

Status: Completed on 2026-03-27.

Goal:

- add a reliable fallback when browser `speechSynthesis` is missing or unstable.

Implementation:

1. `POST /api/tts` route returns audio bytes/stream (OpenAI TTS).
2. UI toggle in Voice panel: `Browser TTS` / `Server TTS Fallback`.
3. Browser TTS is the default free path.
4. On server mode, fetch audio and play via `Audio` element.
5. Stop/Interrupt behavior works for both browser and server playback.

Auto-detection and auto-fallback:

1. On page load, if browser `speechSynthesis` is unavailable and `NEXT_PUBLIC_ENABLE_SERVER_TTS=true`, server TTS mode is auto-selected.
2. At runtime, if browser TTS fires an error while playing a reply, the system automatically retries via server TTS (if enabled) without user intervention.
3. The Voice panel shows an info note when auto-detection or auto-fallback activates.
4. Manual override via radio buttons is always available.

Centralized TTS manager:

- `lib/audio/ttsManager.ts` encapsulates detection, playback, and fallback logic.
- `detectBestTtsMode(serverEnabled)` — returns optimal mode based on browser capabilities.
- `speakWithFallback(text, options)` — tries preferred mode, auto-falls back on error.
- `stopAll()` — cancels active browser and server audio playback.

Acceptance criteria:

1. User can switch modes without page reload.
2. Browser TTS path remains unchanged and free by default.
3. Server TTS path plays reply audio end-to-end when enabled.
4. Auto-fallback activates transparently when browser TTS fails and server TTS is enabled.

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

For server STT/TTS fallback, set `OPENAI_API_KEY` in `.env.local`.
To enable server TTS fallback in the Voice panel, set `NEXT_PUBLIC_ENABLE_SERVER_TTS=true`.

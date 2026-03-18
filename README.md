# EVA Roadmap (Emotionally Aware Virtual Assistant)

EVA is being built on Next.js (App Router), not plain React SPA. This gives you one codebase for UI, API routes, server logic, and deployment.

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
- STT: Browser Web Speech API first, Whisper fallback
- TTS: ElevenLabs or OpenAI TTS; browser speech synthesis fallback

### Memory + Data

- PostgreSQL + Prisma for structured memory and history
- Redis for short-lived session/context cache
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

1. Add Prisma schema for users, conversations, memory facts.
2. Save each chat turn with metadata (time, sentiment, tags).
3. Retrieve top relevant memory before each LLM call.
4. Add memory guardrails (no sensitive storage by default).

Definition of done:

- EVA references previous user preferences accurately.

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

1. Add client microphone controls.
2. Implement STT pipeline (browser first, server fallback).
3. Implement TTS pipeline and audio playback queue.
4. Add interruption support (user can stop speech).

Definition of done:

- user can have a full voice interaction loop.

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
prisma/
	schema.prisma
```

## API Contracts (Initial)

- `POST /api/chat`
	- input: messages, userId, sessionId
	- output: assistantText, emotion, memoryUsed

- `POST /api/emotion`
	- input: text
	- output: label, confidence

- `POST /api/memory`
	- input: userId, message, emotion
	- output: savedFactIds

- `POST /api/tts`
	- input: text, voiceId
	- output: audio stream or URL

## KPI Targets

- chat first-token latency: less than 1.5s (streaming)
- voice round-trip latency: less than 3.5s
- memory recall precision in test prompts: more than 80%
- emotion classification agreement on labeled set: more than 75%

## Immediate Next 5 Tasks (Start Today)

1. Replace starter UI in `app/page.tsx` with EVA chat shell.
2. Build `app/api/chat/route.ts` using OpenAI SDK.
3. Add simple in-memory conversation state for MVP.
4. Add emotion detection utility (rule-based first).
5. Add README section for env vars and run instructions.

## Local Development

```bash
npm install
npm run dev
```

Open http://localhost:3000.

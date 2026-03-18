import { AvatarPanel } from "@/components/avatar/AvatarPanel";
import { ChatPanel } from "@/components/chat/ChatPanel";
import { VoicePanel } from "@/components/voice/VoicePanel";

export default function Home() {
  return (
    <main className="eva-page">
      <header className="eva-hero">
        <p className="eva-kicker">Emotionally Aware Virtual Assistant</p>
        <h1>EVA</h1>
        <p className="eva-subtitle">
          Next.js-first foundation is live. Phase 0 is now ready for conversation,
          memory, emotion, and voice integration.
        </p>
      </header>

      <section className="eva-grid">
        <ChatPanel />
        <VoicePanel />
        <AvatarPanel />
        <section className="eva-card">
          <div className="eva-section-header">
            <h2>System Status</h2>
            <span className="eva-pill">Phase 0</span>
          </div>
          <ul className="eva-list">
            <li>Next.js App Router: active</li>
            <li>API health endpoint: active</li>
            <li>Chat route scaffold: active</li>
            <li>Environment strategy: active</li>
            <li>Error handling and logger: active</li>
          </ul>
        </section>
      </section>

      <section className="eva-architecture">
        <h2>High-level Flow</h2>
        <p>
          User -{">"} Frontend -{">"} STT -{">"} Conversation Engine -{">"}
          Emotion + Memory -{">"} TTS -{">"} Avatar
        </p>
      </section>
    </main>
  );
}

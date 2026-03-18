export function VoicePanel() {
  return (
    <section className="eva-card">
      <div className="eva-section-header">
        <h2>Voice</h2>
        <span className="eva-pill">STT + TTS</span>
      </div>
      <div className="eva-voice-actions">
        <button className="eva-btn" type="button" disabled>
          Start Mic (Phase 4)
        </button>
        <button className="eva-btn eva-btn-secondary" type="button" disabled>
          Play Voice Reply
        </button>
      </div>
      <p className="eva-note">Voice loop will be enabled after chat streaming and emotion hooks.</p>
    </section>
  );
}

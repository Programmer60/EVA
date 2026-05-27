"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/nextjs";

type MemoryItem = {
  id: string;
  key: string;
  value: string;
  importance: number;
  source: string;
  lastAccessed: string | null;
  memoryMentionCount: number;
  lastMentionedAt: string | null;
};

type UserProfile = {
  userId: string;
  bondTier: string;
  bondScore: number;
  dominantEmotion: string;
  dominantReplyMode: string;
  dominantTone: string;
  activeArcs: number;
  recurringTopics: string[];
  recentMemories: string[];
  observedPatterns: string[];
  summary: string;
} | null;

type MemoryResponse = {
  userId: string;
  count: number;
  profile: UserProfile;
  memories: MemoryItem[];
};

export default function ProfilePage() {
  const { userId } = useAuth();
  const [profile, setProfile] = useState<UserProfile>(null);
  const [memories, setMemories] = useState<MemoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedMemory = useMemo(() => memories.find((memory) => memory.id === selectedId) ?? null, [memories, selectedId]);

  const [editKey, setEditKey] = useState("");
  const [editValue, setEditValue] = useState("");
  const [editImportance, setEditImportance] = useState("0.5");
  const [editSource, setEditSource] = useState("chat");

  useEffect(() => {
    if (!userId) {
      return;
    }

    const controller = new AbortController();

    async function loadProfile() {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(
          `/api/memory?limit=100&includeProfile=true`,
          {
            signal: controller.signal,
            cache: "no-store",
          },
        );

        if (!response.ok) {
          throw new Error("Could not load memory profile.");
        }

        const data = (await response.json()) as MemoryResponse;
        setProfile(data.profile);
        setMemories(data.memories);
        if (!selectedId && data.memories.length > 0) {
          setSelectedId(data.memories[0].id);
        }
      } catch (loadError) {
        if (loadError instanceof DOMException && loadError.name === "AbortError") {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();

    return () => controller.abort();
  }, [userId, selectedId]);

  useEffect(() => {
    if (!selectedMemory) {
      setEditKey("");
      setEditValue("");
      setEditImportance("0.5");
      setEditSource("chat");
      return;
    }

    setEditKey(selectedMemory.key);
    setEditValue(selectedMemory.value);
    setEditImportance(String(selectedMemory.importance));
    setEditSource(selectedMemory.source);
  }, [selectedMemory]);

  async function saveMemory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedMemory) {
      return;
    }

    setSaving(selectedMemory.id);
    try {
      const response = await fetch("/api/memory", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          memoryId: selectedMemory.id,
          key: editKey,
          value: editValue,
          importance: Number(editImportance),
          source: editSource,
        }),
      });

      if (!response.ok) {
        throw new Error("Could not save memory.");
      }

      const payload = await response.json() as { memory: MemoryItem };
      setMemories((previous) => previous.map((memory) => (memory.id === payload.memory.id ? payload.memory : memory)));
      setProfile((previous) => previous);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Failed to save memory.");
    } finally {
      setSaving(null);
    }
  }

  async function deleteMemory(memoryId: string) {
    setSaving(memoryId);
    try {
      const response = await fetch("/api/memory", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, memoryId }),
      });

      if (!response.ok) {
        throw new Error("Could not delete memory.");
      }

      setMemories((previous) => previous.filter((memory) => memory.id !== memoryId));
      if (selectedId === memoryId) {
        setSelectedId(null);
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Failed to delete memory.");
    } finally {
      setSaving(null);
    }
  }

  return (
    <main className="eva-page eva-profile-page">
      <header className="eva-hero">
        <p className="eva-kicker">Memory Editor</p>
        <h1>What EVA knows about you</h1>
        <p className="eva-subtitle">View, edit, and remove memories for your current browser profile.</p>
      </header>

      <section className="eva-dashboard-grid">
        <article className="eva-card eva-metric-card">
          <h2>Current Profile</h2>
          <strong>{profile?.bondTier ?? "new"}</strong>
          <span>{profile?.summary ?? "No profile data yet."}</span>
        </article>
        <article className="eva-card eva-metric-card">
          <h2>User ID</h2>
          <strong>{userId}</strong>
          <span>Stored in this browser only</span>
        </article>
      </section>

      <section className="eva-grid eva-dashboard-stack">
        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Profile Snapshot</h2>
            <span className="eva-pill">{memories.length} memories</span>
          </div>
          {profile ? (
            <div className="eva-profile-panel">
              <p className="eva-note">{profile.summary}</p>
              <ul className="eva-list">
                <li>Bond score: {profile.bondScore.toFixed(2)}</li>
                <li>Dominant emotion: {profile.dominantEmotion}</li>
                <li>Dominant reply mode: {profile.dominantReplyMode}</li>
                <li>Tone tendency: {profile.dominantTone}</li>
                <li>Active arcs: {profile.activeArcs}</li>
              </ul>
            </div>
          ) : (
            <p className="eva-note">No profile data yet. Send a few messages to populate it.</p>
          )}
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Memory List</h2>
            <span className="eva-pill">{loading ? "Loading" : "Ready"}</span>
          </div>

          {error ? <p className="eva-note">{error}</p> : null}

          <div className="eva-table-wrap">
            <table className="eva-table">
              <thead>
                <tr>
                  <th>Key</th>
                  <th>Value</th>
                  <th>Importance</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {memories.map((memory) => (
                  <tr key={memory.id}>
                    <td>{memory.key}</td>
                    <td>{memory.value}</td>
                    <td>{memory.importance.toFixed(2)}</td>
                    <td>
                      <div className="eva-inline-actions">
                        <button type="button" className="eva-button eva-button-secondary" onClick={() => setSelectedId(memory.id)}>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="eva-button eva-button-secondary"
                          onClick={() => void deleteMemory(memory.id)}
                          disabled={saving === memory.id}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!loading && memories.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No memories stored yet.</td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="eva-card">
          <div className="eva-section-header">
            <h2>Edit Memory</h2>
            <span className="eva-pill">{selectedMemory ? selectedMemory.id.slice(0, 8) : "None"}</span>
          </div>

          {selectedMemory ? (
            <form className="eva-form" onSubmit={(event) => void saveMemory(event)}>
              <label>
                Key
                <input value={editKey} onChange={(event) => setEditKey(event.target.value)} />
              </label>
              <label>
                Value
                <textarea value={editValue} onChange={(event) => setEditValue(event.target.value)} rows={4} />
              </label>
              <label>
                Importance
                <input type="number" min="0" max="1" step="0.05" value={editImportance} onChange={(event) => setEditImportance(event.target.value)} />
              </label>
              <label>
                Source
                <input value={editSource} onChange={(event) => setEditSource(event.target.value)} />
              </label>
              <div className="eva-inline-actions">
                <button type="submit" className="eva-button" disabled={saving === selectedMemory.id}>
                  Save changes
                </button>
                <button type="button" className="eva-button eva-button-secondary" onClick={() => setSelectedId(null)}>
                  Clear
                </button>
              </div>
            </form>
          ) : (
            <p className="eva-note">Select a memory to edit it.</p>
          )}
        </section>
      </section>
    </main>
  );
}
# EVA — Emotionally Aware Virtual Assistant

A modern AI companion focused on emotionally intelligent conversations, voice interaction, memory, and adaptive emotional presence.

> EVA is not just another chatbot. It is designed to feel calm, emotionally aware, visually alive, and capable of maintaining meaningful conversational continuity.

---

## ✨ Features

### 🧠 Emotionally Aware Conversations
- Detects emotional tone from user input in real-time.
- Maintains conversational warmth and continuity across sessions.
- **Adaptive response styles**: Empathetic, curious, calming, reflective, and supportive.

### 🎙️ Voice Interaction
- **Speech-to-Text (STT)**: Speak naturally to EVA.
- **Text-to-Speech (TTS)**: Hear EVA's replies with emotion-driven pacing.
- Built-in Browser TTS support with seamless **Google Cloud TTS** integration.
- Auto-play voice replies for a hands-free companion experience.

### 🧩 Long-Term Memory System
- Short-term conversational context backed by high-speed **Redis**.
- Long-term memory extraction, summarization, and retrieval via **MongoDB**.
- Conversation continuity and bond progression tracking.

### 🎭 Dynamic Emotional States
EVA tracks and adapts to:
- Mood and emotional baseline
- Active conversation threads
- Conversational bond (New Acquaintance → Close Friend)
- Wellness and life events (Exams, interviews, etc.)

### 🌸 Animated Avatar System
- Live SVG-based companion avatar.
- Emotion-reactive visual presence (blushing, pupil dilation, gaze drift).
- Idle breathing, thinking, and listening states.
- Fully implemented **Lip-sync** powered by Web Audio API.

---

## 🛠️ Tech Stack

### Frontend
- **Framework**: Next.js 16 (App Router), React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS

### Backend & Data
- **API**: Next.js API Routes (Node.js edge)
- **Database**: MongoDB (Mongoose)
- **Caching / Rate Limiting**: Upstash Redis
- **Authentication**: Clerk

### AI & Voice
- **LLM Routing**: OpenRouter API (Defaulting to Google Gemini)
- **Voice**: Web Speech APIs & Google Cloud TTS

---

## 🚀 Installation

**1. Clone the repository**
```bash
git clone https://github.com/yourusername/eva.git
cd eva
```

**2. Install dependencies**
```bash
npm install
```

**3. Configure environment variables**
Create a `.env.local` file in the root directory:
```env
# AI Models
OPENROUTER_API_KEY=your_openrouter_key

# Databases
MONGODB_URI=your_mongodb_uri
REDIS_URL=your_redis_url

# Authentication
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=your_clerk_key
CLERK_SECRET_KEY=your_clerk_secret

# Admin Access
ADMIN_USER_ID=your_clerk_user_id

# Voice (Optional)
NEXT_PUBLIC_ENABLE_SERVER_TTS=true
GOOGLE_APPLICATION_CREDENTIALS_JSON=your_google_json
```

**4. Run development server**
```bash
npm run dev
```

---

## 🔮 Planned Features
- Mobile app (React Native / Expo)
- Local AI inference mode (Ollama / Llama.cpp)
- Multi-avatar support
- Persistent user profile dashboard expansion

---

## 🧠 EVA Philosophy

Most AI assistants are optimized for productivity. **EVA is optimized for emotional presence, conversational comfort, reflective interaction, and continuity.**

The goal is to create an assistant that feels:
- Calm
- Emotionally attentive
- Visually alive
- Non-judgmental
- Naturally conversational

---

## ⚠️ Disclaimer
EVA is an emotional AI companion project and is **not** a replacement for professional mental health support.

## 📄 License
MIT License

## 👨‍💻 Author
Built with curiosity, experimentation, and emotional design exploration.
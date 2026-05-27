# EVA (Emotionally Aware Virtual Assistant)

EVA is a next-generation AI companion designed with emotional intelligence, memory continuity, and an expressive, dynamic presence. Unlike standard chatbots, EVA doesn't just answer questions—she tracks conversational state, emotional undertones, and relationship growth over time to provide a truly human-like companion experience.

## ✨ Features

- **Emotional Intelligence Engine**: Real-time emotion detection, tracking, and response pacing.
- **Dynamic Face & Avatar**: A fully reactive SVG-based face with eye-tracking, lip-sync, and presence states (Idle, Thinking, Speaking).
- **Proactive Initiative**: EVA can proactively reach out based on time passed, life events, or emotional momentum.
- **Long-Term Memory**: Persistent memory storage using MongoDB with intelligent context retrieval and conversation summarization.
- **Behavioral Profiles & Bonds**: A relationship engine that tracks bond scores (from new acquaintance to close friend).
- **Voice Capabilities**: Web Audio API integration with browser and server-side text-to-speech fallback.

## 🛠 Tech Stack

- **Frontend**: Next.js 16 (App Router), React 19, Tailwind CSS
- **Backend**: Next.js API Routes, Node.js
- **Database**: MongoDB (Mongoose)
- **Caching & Rate Limiting**: Upstash Redis (`ioredis`)
- **Authentication**: Clerk
- **AI Models**: Google Gemini (Primary), OpenRouter API (Fallback)
- **Voice**: Web Speech API / Google Cloud Text-to-Speech

## 🚀 Getting Started

### Prerequisites
- Node.js 20+
- MongoDB Atlas cluster
- Upstash Redis instance
- Clerk account
- OpenRouter & Google Gemini API keys

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/eva-ai.git
   cd eva-ai
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Configure Environment Variables:
   Copy `.env.local.example` to `.env.local` and fill in your API keys.

4. Start the development server:
   ```bash
   npm run dev
   ```

5. Open [http://localhost:3000](http://localhost:3000) in your browser.

## 📚 Documentation

For in-depth architectural details, development logs, and AI behavior engine documentation, please see the `docs/` folder:
- [Development Log & Architecture](docs/DEVELOPMENT_LOG.md)

# 🗄️ EVA Database Setup Guide

## What Was Created

### 1. **MongoDB Connection** (`lib/mongodb.ts`)
- Handles database connection initialization
- Prevents multiple connections (connection pooling)

### 2. **Database Schemas**
Three Mongoose schemas for your data:

- **User Schema** (`lib/models/User.ts`)
  - `name`: User's name
  - `preferences`: Array of user preferences
  - `createdAt`: Timestamp

- **Message Schema** (`lib/models/Message.ts`)
  - `userId`: User identifier
  - `role`: "user" or "eva"
  - `content`: Message text
  - `timestamp`: When sent

- **Memory Schema** (`lib/models/Memory.ts`)
  - `userId`: User identifier
  - `key`: Memory key
  - `value`: Memory value
  - `importance`: Priority level
  - `lastAccessed`: Last access time

### 3. **Updated Chat API** (`app/api/chat/route.ts`)
- Now saves every user and assistant message to MongoDB
- Maintains full conversation history

### 4. **History Endpoint** (`app/api/history/route.ts`)
- Fetch previous conversations
- Usage: `/api/history?userId=user123&limit=10`

## 🚀 Next Steps

### Step 1: Get MongoDB Connection String
1. Go to [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a free account
3. Create a new cluster
4. Click "Connect" → "Drivers" → select Node.js
5. Copy the connection string
6. Replace `<password>` and `<username>` with actual credentials

### Step 2: Get OpenAI API Key
1. Go to [OpenAI API Keys](https://platform.openai.com/api-keys)
2. Create new secret key
3. Copy the key

### Step 3: Create `.env.local`
Create `c:\Users\mishr\Desktop\EVA\eva-ai\.env.local`:

```env
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/eva?retryWrites=true&w=majority
OPENAI_API_KEY=sk-...
```

### Step 4: Test Connection
Run your dev server:
```bash
npm run dev
```

Send a test message to `/api/chat` to verify:
- Message is saved to MongoDB
- Response is generated from OpenAI
- Everything works end-to-end

## 📋 Database Architecture

```
Next.js (Frontend + API routes)
    ↓
MongoDB (Memory + Chat + Users)
    ↓
OpenAI API (Brain)
```

## 🔑 Key Features Implemented

✅ **Message Persistence** - Every chat is saved  
✅ **User Associations** - Track conversations per user  
✅ **History Retrieval** - Fetch past conversations  
✅ **Memory Storage** - Foundation for memory recall feature  
✅ **Scalable Design** - Ready for production

## 💡 What Makes This Better Than Average

Unlike basic chatbots, EVA now:
- **Remembers conversations** - Full chat history in MongoDB
- **User context** - Each user has their own memory space
- **Scalable** - Can handle multiple users simultaneously
- **Production-ready** - Proper connection pooling and error handling

## ⚠️ Important Notes

- Never commit `.env.local` (it's in .gitignore conceptually)
- MongoDB Atlas free tier: 512MB storage (plenty for testing)
- Each message pair = ~200 bytes, so free tier = ~2,500 conversations
- For production, upgrade to paid MongoDB tier

## 📞 Endpoints Created

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/chat` | POST | Send message, get response |
| `/api/health` | GET | Health check |
| `/api/history` | GET | Fetch conversation history |

---

You're now ready to make EVA truly "aware" by building memory recall on top of this foundation!

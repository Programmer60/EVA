type AppEnv = {
  nodeEnv: string;
  geminiApiKey: string | null;
  geminiModel: string;
  openRouterApiKey: string | null;
  openRouterModel: string;
  elevenLabsApiKey: string | null;
  databaseUrl: string | null;
  mongodbUri: string | null;
  redisUrl: string | null;
};

function clean(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export const env: AppEnv = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  geminiApiKey: clean(process.env.GEMINI_API_KEY),
  geminiModel: clean(process.env.GEMINI_MODEL) ?? "gemini-2.0-flash",
  openRouterApiKey: clean(process.env.OPENROUTER_API_KEY),
  openRouterModel:
    clean(process.env.OPENROUTER_MODEL) ?? "mistralai/mistral-7b-instruct",
  elevenLabsApiKey: clean(process.env.ELEVENLABS_API_KEY),
  databaseUrl: clean(process.env.DATABASE_URL),
  mongodbUri: clean(process.env.MONGODB_URI),
  redisUrl: clean(process.env.REDIS_URL),
};

export function requireEnv(name: string): string {
  const value = clean(process.env[name]);

  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

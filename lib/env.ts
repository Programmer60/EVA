type AppEnv = {
  nodeEnv: string;
  openAiApiKey: string | null;
  openAiModel: string;
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
  openAiApiKey: clean(process.env.OPENAI_API_KEY),
  openAiModel: clean(process.env.OPENAI_MODEL) ?? "gpt-4.1-mini",
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

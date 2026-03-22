import mongoose from "mongoose";
import { env } from "./env";
import { AppError } from "./errors";

export async function connectDB() {
  const mongoUri = env.mongodbUri ?? env.databaseUrl;

  if (!mongoUri) {
    throw new AppError(
      "Missing MongoDB connection string. Set MONGODB_URI (or DATABASE_URL) in .env.local.",
      503,
    );
  }

  if (mongoose.connection.readyState === 1) return;

  try {
    await mongoose.connect(mongoUri);
  } catch {
    throw new AppError(
      "Could not connect to MongoDB. Verify MONGODB_URI and that MongoDB is running.",
      503,
    );
  }
}

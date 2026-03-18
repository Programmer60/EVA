import mongoose from "mongoose";
import { env } from "./env";

const MONGODB_URI = env.mongodbUri;

if (!MONGODB_URI) {
  throw new Error("Please define the MONGODB_URI environment variable");
}

export async function connectDB() {
  if (mongoose.connection.readyState === 1) return;

  await mongoose.connect(MONGODB_URI);
}

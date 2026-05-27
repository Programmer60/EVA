import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "Privacy Policy | EVA",
  description: "How EVA protects your privacy and data.",
};

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-background text-foreground flex justify-center py-12 px-6 sm:px-12 relative overflow-hidden">
      {/* Subtle Background Glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="max-w-3xl w-full z-10">
        <Link
          href="/"
          className="inline-flex items-center text-sm font-medium text-muted-foreground hover:text-primary transition-colors mb-8 group"
        >
          <ArrowLeft className="w-4 h-4 mr-2 group-hover:-translate-x-1 transition-transform" />
          Back to Home
        </Link>

        <h1 className="text-4xl sm:text-5xl font-serif tracking-tight mb-6">
          Privacy Policy
        </h1>
        <p className="text-sm text-muted-foreground mb-8">Last updated: May 2026</p>

        <div className="space-y-8 text-lg text-foreground/80 leading-relaxed font-light">
          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Data Collection & Storage</h2>
            <p>
              We collect information to provide a deeply personalized experience. This includes basic profile information from your authentication provider (like email and name) and the contents of your conversations with EVA. Your chat history is stored securely in our database and linked strictly to your unique, authenticated user identity.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Emotional Memory</h2>
            <p>
              To act as a true companion, EVA utilizes "Emotional Memory." This means EVA processes your conversations to extract meaningful facts, preferences, and emotional states. This structured data is used solely to contextualize future interactions. We do not sell your memories or conversational data to third parties, advertisers, or data brokers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Third-Party Processors</h2>
            <p>
              We rely on trusted third-party services to power EVA's intelligence:
            </p>
            <ul className="list-disc pl-6 space-y-2">
              <li><strong>Clerk:</strong> Manages secure user authentication.</li>
              <li><strong>OpenRouter / Google / OpenAI:</strong> Processes text generation and sentiment analysis.</li>
              <li><strong>ElevenLabs / Google Cloud TTS:</strong> Generates responsive voice audio.</li>
            </ul>
            <p>
              When processing inputs, anonymized or strictly scoped text payloads are sent to these providers. They are contractually obligated to protect data and, depending on the model, do not use your inputs for generalized AI training.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Your Rights</h2>
            <p>
              You maintain full ownership of your data. You have the right to request a complete export of your memories, delete specific conversation blocks, or completely wipe your account and all associated conversational history from our servers.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Contact</h2>
            <p>
              If you have any questions or concerns regarding your privacy, please don't hesitate to reach out to our privacy team through your dashboard settings.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export const metadata = {
  title: "About Us | EVA",
  description: "Learn more about EVA - your emotional companion.",
};

export default function AboutPage() {
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
          About EVA
        </h1>

        <div className="space-y-8 text-lg text-foreground/80 leading-relaxed font-light">
          <p>
            Welcome to EVA, the Emotionally Aware Virtual Assistant. Our mission is to bridge the gap between human emotion and artificial intelligence, creating a companion that doesn't just respond to commands, but truly understands how you feel.
          </p>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Our Philosophy</h2>
            <p>
              Technology has connected us globally, yet many still feel unheard. EVA was designed with empathy at its core. By analyzing emotional undertones, remembering past conversations, and adjusting its tone to match your mood, EVA provides a safe space for reflection, curiosity, and companionship.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">How It Works</h2>
            <p>
              EVA utilizes state-of-the-art language models and sentiment analysis to process your text and voice inputs. As you interact, EVA slowly builds a relationship bond with you—growing from a new acquaintance to a trusted companion. Your memories and preferences are respectfully woven into future conversations, making every interaction uniquely yours.
            </p>
          </section>

          <section className="space-y-4">
            <h2 className="text-2xl font-medium text-foreground tracking-tight">Commitment to Privacy</h2>
            <p>
              We believe emotional connection requires absolute trust. Your emotional data, memories, and chat history are secured using industry-standard authentication. You are always in control of your digital footprint with EVA.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

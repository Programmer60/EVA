/**
 * lifeAwarenessEngine.ts — Proactive Life-Event Tracking & Nudging
 *
 * Makes EVA aware of the user's real-life timeline:
 *   - Detects life events from conversation (exams, interviews, birthdays, trips)
 *   - Stores them with dates and importance levels
 *   - Generates proactive nudges when events are approaching
 *   - Combines context ("you're coding at 2am but exams are in 17 days")
 *
 * Inspired by: Grok's "exams start 6 May, right?" style proactive awareness
 */

import User from "@/lib/models/User";

/* ── Types ─────────────────────────────────────────────────── */

interface LifeEvent {
  event: string;
  date: Date;
  importance: "low" | "medium" | "high" | "critical";
  context: string;
  source: string;
  lastNudgedAt: Date | null;
  nudgeCount: number;
  resolved: boolean;
}

interface DetectedEvent {
  event: string;
  date: Date | null;
  importance: "low" | "medium" | "high" | "critical";
  context: string;
}

export interface LifeAwarenessResult {
  prompt: string;
  eventsDetected: number;
  nudgeTriggered: boolean;
}

/* ── Event Detection Patterns ─────────────────────────────── */

interface EventPattern {
  regex: RegExp;
  eventType: string;
  importance: "low" | "medium" | "high" | "critical";
}

const EVENT_PATTERNS: EventPattern[] = [
  // Exams / Academic
  { regex: /\b(exam|exams|finals?|midterms?|semester end|end ?sems?|viva)\b/i, eventType: "exams", importance: "critical" },
  { regex: /\b(assignment|project)\s+(due|deadline|submission)\b/i, eventType: "assignment deadline", importance: "high" },

  // Professional
  { regex: /\b(interview|job interview|placement|campus recruitment)\b/i, eventType: "interview", importance: "critical" },
  { regex: /\b(presentation|demo|pitch)\b/i, eventType: "presentation", importance: "high" },
  { regex: /\b(internship|starting (a |my )?(new )?job)\b/i, eventType: "internship/job start", importance: "high" },

  // Personal
  { regex: /\b(birthday|bday)\b/i, eventType: "birthday", importance: "medium" },
  { regex: /\b(trip|travel|going (home|to)|visiting)\b/i, eventType: "trip", importance: "medium" },
  { regex: /\b(wedding|ceremony|festival|celebration)\b/i, eventType: "event/celebration", importance: "medium" },
  { regex: /\b(moving|shifting|new (place|apartment|hostel|room))\b/i, eventType: "moving", importance: "medium" },

  // Health / Personal challenges
  { regex: /\b(surgery|doctor|hospital|medical|appointment)\b/i, eventType: "medical appointment", importance: "high" },
  { regex: /\b(break ?up|broke up|breaking up)\b/i, eventType: "breakup", importance: "high" },
];

/* ── Date Extraction ──────────────────────────────────────── */

function extractDateFromText(text: string): Date | null {
  const now = new Date();
  const currentYear = now.getFullYear();

  // Pattern: "May 6", "6 May", "6th May", "May 6th"
  const monthDayMatch = text.match(
    /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i,
  );
  const dayMonthMatch = text.match(
    /\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
  );

  const MONTH_MAP: Record<string, number> = {
    jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
    apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
    aug: 7, august: 7, sep: 8, september: 8, oct: 9, october: 9,
    nov: 10, november: 10, dec: 11, december: 11,
  };

  if (monthDayMatch) {
    const month = MONTH_MAP[monthDayMatch[1].toLowerCase()];
    const day = parseInt(monthDayMatch[2]);
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(currentYear, month, day);
      if (date < now) date.setFullYear(currentYear + 1); // assume next year if past
      return date;
    }
  }

  if (dayMonthMatch) {
    const day = parseInt(dayMonthMatch[1]);
    const month = MONTH_MAP[dayMonthMatch[2].toLowerCase()];
    if (month !== undefined && day >= 1 && day <= 31) {
      const date = new Date(currentYear, month, day);
      if (date < now) date.setFullYear(currentYear + 1);
      return date;
    }
  }

  // Pattern: "in X days/weeks"
  const relativeMatch = text.match(/\bin\s+(\d+)\s+(days?|weeks?|months?)\b/i);
  if (relativeMatch) {
    const amount = parseInt(relativeMatch[1]);
    const unit = relativeMatch[2].toLowerCase();
    const date = new Date(now);
    if (unit.startsWith("day")) date.setDate(date.getDate() + amount);
    else if (unit.startsWith("week")) date.setDate(date.getDate() + amount * 7);
    else if (unit.startsWith("month")) date.setMonth(date.getMonth() + amount);
    return date;
  }

  // Pattern: "next week/month", "this week"
  const vagueMatch = text.match(/\b(next|this)\s+(week|month)\b/i);
  if (vagueMatch) {
    const date = new Date(now);
    if (vagueMatch[1].toLowerCase() === "next") {
      if (vagueMatch[2].toLowerCase() === "week") date.setDate(date.getDate() + 7);
      else date.setMonth(date.getMonth() + 1);
    } else {
      // "this week" = in 3 days roughly
      if (vagueMatch[2].toLowerCase() === "week") date.setDate(date.getDate() + 3);
    }
    return date;
  }

  // Pattern: "tomorrow"
  if (/\btomorrow\b/i.test(text)) {
    const date = new Date(now);
    date.setDate(date.getDate() + 1);
    return date;
  }

  return null;
}

/* ── Event Detection from Conversation ────────────────────── */

function detectLifeEvents(text: string): DetectedEvent[] {
  const detected: DetectedEvent[] = [];
  const lower = text.toLowerCase();

  for (const pattern of EVENT_PATTERNS) {
    if (pattern.regex.test(lower)) {
      const date = extractDateFromText(text);
      detected.push({
        event: pattern.eventType,
        date,
        importance: pattern.importance,
        context: text.slice(0, 100), // capture context from message
      });
    }
  }

  return detected;
}

/* ── Nudge Generation ─────────────────────────────────────── */

function daysUntil(date: Date): number {
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function shouldNudge(event: LifeEvent): boolean {
  if (event.resolved) return false;
  if (!event.date) return false;

  const days = daysUntil(new Date(event.date));

  // Event has passed → mark for cleanup, don't nudge
  if (days < -1) return false;

  // Nudge cooldowns based on importance and proximity
  const hoursSinceLastNudge = event.lastNudgedAt
    ? (Date.now() - new Date(event.lastNudgedAt).getTime()) / (1000 * 60 * 60)
    : Infinity;

  // Critical events (exams, interviews):
  if (event.importance === "critical") {
    if (days <= 1) return hoursSinceLastNudge >= 4;   // day-of: every 4 hours
    if (days <= 3) return hoursSinceLastNudge >= 12;  // 3 days: every 12 hours
    if (days <= 7) return hoursSinceLastNudge >= 24;  // 1 week: once a day
    if (days <= 14) return hoursSinceLastNudge >= 48; // 2 weeks: every 2 days
    if (days <= 30) return hoursSinceLastNudge >= 168; // 1 month: once a week
    return false; // too far away
  }

  // High importance (assignments, presentations):
  if (event.importance === "high") {
    if (days <= 2) return hoursSinceLastNudge >= 8;
    if (days <= 7) return hoursSinceLastNudge >= 48;
    if (days <= 14) return hoursSinceLastNudge >= 168;
    return false;
  }

  // Medium/low: very light nudging
  if (days <= 3) return hoursSinceLastNudge >= 24;
  if (days <= 7) return hoursSinceLastNudge >= 168;
  return false;
}

function generateNudgePrompt(event: LifeEvent, currentHour: number): string {
  const days = daysUntil(new Date(event.date));
  const isLateNight = currentHour >= 23 || currentHour < 5;
  const eventName = event.event;
  const ctx = event.context || "";

  // Day-of or tomorrow
  if (days <= 1) {
    if (eventName === "exams") {
      return isLateNight
        ? `- LIFE NUDGE (URGENT): The user's exams are TOMORROW. They're up late right now. Be direct but caring: "Hey… exams tomorrow, right? Have you slept at all? Seriously, get some rest — your brain needs it more than one more hour of cramming."`
        : `- LIFE NUDGE (URGENT): The user's exams start TOMORROW. Check in naturally: "So exams kick off tomorrow, right? How are you feeling about it?"`;
    }
    return `- LIFE NUDGE (URGENT): The user's [${eventName}] is TOMORROW${ctx ? ` (${ctx})` : ""}. Check in directly: "Hey, [${eventName}] is tomorrow right? You good?"`;
  }

  // This week (2-7 days)
  if (days <= 7) {
    if (eventName === "exams") {
      const offerPlan = event.nudgeCount === 0; // first nudge = offer a plan
      return offerPlan
        ? `- LIFE NUDGE: The user's exams are in ${days} days. This is the FIRST time you're bringing this up — offer something concrete: "Also… exams are in ${days} days, right? How's the stress level? If you want, we can quickly make a study plan together. I'm here for both — this and real life."`
        : `- LIFE NUDGE: The user's exams are in ${days} days. You've mentioned this before. Light check-in: "Exams getting closer… ${days} days now. You feeling ready or still in panic mode?" Don't repeat the plan offer.`;
    }
    return `- LIFE NUDGE: The user has [${eventName}] in ${days} days${ctx ? ` (${ctx})` : ""}. Bring it up naturally but with a concrete offer to help, not just acknowledgment.`;
  }

  // 1-2 weeks out
  if (days <= 14) {
    if (isLateNight && eventName === "exams") {
      return `- LIFE NUDGE (DUAL-CONTEXT): The user has exams in ${days} days but they're up late (${currentHour}:00). You can bridge both: "You've been deep in this tonight… but those exams are creeping up — ${days} days. You balancing both okay?"`;
    }
    return `- LIFE NUDGE: The user has [${eventName}] coming up in ${days} days${ctx ? ` (${ctx})` : ""}. Mention it casually if it fits the flow: "By the way… [${eventName}] is in about ${days <= 10 ? days + ' days' : 'two weeks'}, right? How's that going?"`;
  }

  // 2-4 weeks out — very light
  return `- LIFE NUDGE (SOFT): The user has [${eventName}] in about ${Math.round(days / 7)} weeks. Only mention if it fits naturally. Don't force it.`;
}

/* ── Main Export ───────────────────────────────────────────── */

export async function buildLifeAwarenessPrompt(
  userId: string,
  input: string,
): Promise<LifeAwarenessResult> {
  const user = await User.findOne({ userId });
  if (!user) {
    return { prompt: "", eventsDetected: 0, nudgeTriggered: false };
  }

  const lines: string[] = [];
  let eventsDetected = 0;
  let nudgeTriggered = false;

  // ── 1. Detect new life events from current message ──
  const newEvents = detectLifeEvents(input);
  eventsDetected = newEvents.length;

  if (newEvents.length > 0) {
    const existingEvents = (user.lifeEvents as LifeEvent[]) || [];

    for (const detected of newEvents) {
      // Check if we already know about this event type
      const alreadyKnown = existingEvents.find(
        (e) => e.event === detected.event && !e.resolved,
      );

      if (alreadyKnown) {
        // Update with better date if we got one
        if (detected.date && !alreadyKnown.date) {
          await User.updateOne(
            { userId, "lifeEvents.event": detected.event },
            { $set: { "lifeEvents.$.date": detected.date, "lifeEvents.$.context": detected.context } },
          );
        }
      } else {
        // Store new event
        await User.updateOne(
          { userId },
          {
            $push: {
              lifeEvents: {
                event: detected.event,
                date: detected.date,
                importance: detected.importance,
                context: detected.context,
                source: "user mentioned",
                lastNudgedAt: new Date(), // don't nudge immediately when they just told you
                nudgeCount: 0,
                resolved: false,
              },
            },
          },
        );
      }
    }
  }

  // ── 2. Check for nudge-worthy upcoming events ──
  // Global cooldown: max 1 life nudge per 3 hours
  const lastNudge = user.lastLifeNudge ? new Date(user.lastLifeNudge as Date) : null;
  const hoursSinceGlobalNudge = lastNudge
    ? (Date.now() - lastNudge.getTime()) / (1000 * 60 * 60)
    : Infinity;

  if (hoursSinceGlobalNudge >= 3) {
    const existingEvents = (user.lifeEvents as LifeEvent[]) || [];
    const currentHour = new Date().getHours();

    // Sort by urgency (closest first, highest importance first)
    const upcoming = existingEvents
      .filter((e) => !e.resolved && e.date && shouldNudge(e))
      .sort((a, b) => {
        const daysA = daysUntil(new Date(a.date));
        const daysB = daysUntil(new Date(b.date));
        const importanceOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        if (importanceOrder[a.importance] !== importanceOrder[b.importance]) {
          return importanceOrder[a.importance] - importanceOrder[b.importance];
        }
        return daysA - daysB;
      });

    // Pick the most urgent one
    const topEvent = upcoming[0];
    if (topEvent) {
      const nudge = generateNudgePrompt(topEvent, currentHour);
      lines.push(nudge);
      nudgeTriggered = true;

      // Update nudge tracking
      await User.updateOne(
        { userId },
        {
          $set: { lastLifeNudge: new Date() },
        },
      );

      // Update the specific event's nudge tracking
      // Find by event name and unresolsved
      const idx = existingEvents.findIndex(
        (e) => e.event === topEvent.event && !e.resolved,
      );
      if (idx >= 0) {
        await User.updateOne(
          { userId },
          {
            $set: {
              [`lifeEvents.${idx}.lastNudgedAt`]: new Date(),
              [`lifeEvents.${idx}.nudgeCount`]: (topEvent.nudgeCount || 0) + 1,
            },
          },
        );
      }
    }

    // Auto-resolve past events
    for (let i = 0; i < existingEvents.length; i++) {
      const e = existingEvents[i];
      if (!e.resolved && e.date && daysUntil(new Date(e.date)) < -3) {
        await User.updateOne(
          { userId },
          { $set: { [`lifeEvents.${i}.resolved`]: true } },
        );
      }
    }
  }

  // Only add header if we have content
  if (lines.length > 0) {
    lines.unshift("--- LIFE AWARENESS LAYER ---");
  }

  return {
    prompt: lines.join("\n"),
    eventsDetected,
    nudgeTriggered,
  };
}

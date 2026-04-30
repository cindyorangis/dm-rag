import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_ADVENTURE_SLUG,
  isAdventureSlug,
} from "@/lib/adventures/config";
import { createSession, listSessions } from "@/lib/sessions/service";

// POST /api/sessions — create a new session
export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));

    const adventureSlug = isAdventureSlug(body.adventureSlug)
      ? body.adventureSlug
      : DEFAULT_ADVENTURE_SLUG;

    const characterContext: string | undefined =
      typeof body.characterContext === "string"
        ? body.characterContext
        : undefined;

    const { sessionId } = await createSession(adventureSlug, characterContext);

    return NextResponse.json({ sessionId });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET /api/sessions — list all sessions (for journal page)
export async function GET() {
  try {
    const sessions = await listSessions();
    return NextResponse.json({ sessions });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

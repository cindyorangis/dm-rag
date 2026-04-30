import { NextRequest, NextResponse } from "next/server";
import { processJournalRequest } from "./service";
import { journalRequestSchema, journalResponseSchema } from "./types";
import { z } from "zod";

// POST /api/journal
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Validate request body
    const parsed = journalRequestSchema.parse(body);
    const { sessionId, messages, pause } = parsed;

    // Process journal request
    const result = await processJournalRequest(
      sessionId,
      messages,
      pause ?? false,
    );

    // Validate response structure
    journalResponseSchema.parse(result);

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof z.ZodError) {
      return NextResponse.json(
        { error: "Invalid request body", details: err.issues },
        { status: 400 },
      );
    }

    // Other errors
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Journal API error:`, message);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}

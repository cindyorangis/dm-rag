import { Message } from "./types";

// Takes 'transcript' as an argument
const getJournalPromptTemplate = (
  transcript: string,
) => `You are a scribe chronicling the adventures of a brave hero in the Forgotten Realms.

Below is a transcript of a D&D session. Write a journal entry in the voice of the player's character — a first-person narrative account of what happened during this session.

Guidelines:
- Write in past tense, first person ("I descended into the cave...", "We fought...")
- Capture key events, decisions, encounters, and outcomes
- Include emotional beats — fear, triumph, curiosity, loss
- Mention notable NPCs, locations, and items encountered
- Keep it 2–4 paragraphs. Evocative prose, not a bullet summary
- Write as if the character is recording this in their personal journal by candlelight

SESSION TRANSCRIPT:
${transcript}

Write the journal entry now:`;

export function buildJournalPrompt(messages: Message[]): string {
  const transcript = messages
    .map(
      (m) => `${m.role === "user" ? "PLAYER" : "DUNGEON MASTER"}: ${m.content}`,
    )
    .join("\n\n");

  // Call the template function and pass the transcript
  return getJournalPromptTemplate(transcript);
}

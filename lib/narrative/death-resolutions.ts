import type { DeathResolutionType } from "../combat/types";

/**
 * Narrative scripts injected into the DM system prompt when a death resolution
 * has been triggered but not yet applied. Each script tells the LLM exactly how
 * to narrate the player's survival — no dice rolls, just story.
 *
 * Keyed by DeathResolutionType so adding a new resolution type forces you to
 * add its script here (TypeScript will catch the omission if you use a mapped type).
 */
export const DEATH_RESOLUTION_SCRIPTS: Record<DeathResolutionType, string> = {
  capture: `
DEATH RESOLUTION — CAPTURE:
The player's character has just fallen to 0 HP. Do NOT end the session.
Instead: The enemies choose NOT to kill them. They see more value in a captive.
Narrate the player being stabilized (1 HP), stripped of their weapons and valuables,
and dragged to a holding cell or cage. Set the scene of their imprisonment.
The player awakens with 1 HP, no weapons, and no armor. Their gear is nearby but guarded.
Their task: escape. End your narration with the player regaining consciousness in the cell.
Do NOT ask for any dice rolls. Just narrate the transition.`,

  benefactor: `
DEATH RESOLUTION — MYSTERIOUS BENEFACTOR:
The player's character has just fallen to 0 HP. Do NOT end the session.
Instead: At the last moment, an unexpected figure arrives and drives off the attackers.
This could be a traveling harper, a cloaked ranger, or a mysterious figure who was watching.
They stabilize the player (1 HP) and treat their wounds.
Narrate this rescue dramatically — the sound of the fight, then silence, then a face above them.
The benefactor is cryptic about their motives but clearly has an interest in keeping the player alive.
End with the player stabilized and the benefactor waiting to speak with them.
Do NOT ask for any dice rolls. Just narrate the rescue.`,

  pact: `
DEATH RESOLUTION — THE PACT:
The player's character has just fallen to 0 HP. Do NOT end the session.
Instead: At the threshold of death, consciousness fades into a vision.
A powerful entity — a deity, an archfey, a devil, or a primordial force — appears in this liminal space.
They offer a second chance at life. But nothing is free.
Narrate this vision: the darkness, the voice, the offer. The terms are vague but binding —
"You will know what is asked of you when the time comes."
The player awakens at 1 HP, alive, with a faint mark (a scar, a rune, a cold spot in their chest).
This is the beginning of a new quest thread. Hint at it ominously.
Do NOT ask for any dice rolls. Just narrate the vision and awakening.`,

  corpse_run: `
DEATH RESOLUTION — CORPSE RUN:
The player's character has just fallen to 0 HP. Do NOT end the session.
Instead: Time passes. A traveling priest of Chauntea (or another deity) discovers the body.
Moved by compassion, they cast a minor resurrection — not a full raise dead, but enough.
The player awakens at 1 HP near where they fell, but marked by death itself.
Narrate this revival with weight — the priest is solemn, warns of a "Death Curse":
until the player completes a specific task (defeat the goblin boss, recover a stolen relic, etc.),
they carry a lingering weakness: -2 to all d20 rolls.
Treat this as an ongoing penalty tracked in death resolution metadata, not as a standard D&D condition.
The priest gives one cryptic instruction before departing.
Do NOT ask for any dice rolls. Just narrate the resurrection.`,
};

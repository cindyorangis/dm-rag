"use client";

import type { ParsedDMResponse } from "@/lib/parse-dm-response";

// Translation map for narrative flags to immersive UI labels
const FLAG_LABELS: Record<string, string> = {
  met_sildar: "A new bond is formed.",
  met_todd: "The bonds of friendship strengthen.",
  met_rick: "A grudge is forged in steel.",
  met_margaret: "Sisterly love reigns supreme.",
  met_brian: "Stranger things await.",
  met_kairos: "The gods smile upon you.",
  met_mother: "Maternal instincts awaken.",
  met_elder: "Ancient wisdom flows through you.",
  rapport_sildar: "Sildar's trust deepens.",
  rapport_todd: "Todd's guard drops.",
  rapport_rick: "Rick begins to listen.",
  rapport_margaret: "Margaret feels understood.",
  rapport_brian: "A connection is made.",
  rapport_kairos: "Kairos sees your sincerity.",
  rapport_mother: "Mother's heart opens.",
  rapport_elder: "The elder respects your intent.",
  status_hall_of_judgment: "The hall holds its secrets.",
  status_sildar_home: "Safety in Sildar's keep.",
  status_todd_home: "Todd's sanctuary awaits.",
  status_rick_home: "Rick's fortress is breached.",
  status_margaret_home: "Home is where the heart is.",
  status_brian_home: "Brian's world is revealed.",
  status_kairos_home: "Kairos's sanctuary.",
  status_mother_home: "Mother's domain.",
  status_elder_home: "The elder's resting place.",
  flag_broken_diplomacy: "Diplomacy shattered.",
  flag_kairos_silenced: "The oracle falls silent.",
  flag_mother_silenced: "Mother's voice is muted.",
  flag_todd_disgraced: "Todd's name cast aside.",
  flag_rick_disgraced: "Rick's honor tarnished.",
  flag_sildar_unchanged: "Sildar stands steadfast.",
  flag_margaret_unchanged: "Margaret remains constant.",
  flag_todd_disappeared: "Gone without a trace.",
  flag_rick_disappeared: "Rick vanished.",
};

interface NarrativeNotificationProps {
  parsed: ParsedDMResponse;
}

export function NarrativeNotification({ parsed }: NarrativeNotificationProps) {
  // Extract flag operations from narrative text
  const extractFlagOps = (
    text: string,
  ): Array<{ key: string; opType: "set" | "inc" | "rm" }> => {
    const ops: Array<{ key: string; opType: "set" | "inc" | "rm" }> = [];

    // Pattern: "ops.set(key, value)" or "ops.inc(key, value)" or "ops.rm(key)"
    const setPattern = /ops\.set\s*\(\s*(['"`])([^'"`]+)\1/g;
    const incPattern = /ops\.inc\s*\(\s*(['"`])([^'"`]+)\1/g;
    const rmPattern = /ops\.rm\s*\(\s*(['"`])([^'"`]+)\1/g;

    let match;

    while ((match = setPattern.exec(text)) !== null) {
      ops.push({ key: match[2], opType: "set" });
    }

    while ((match = incPattern.exec(text)) !== null) {
      ops.push({ key: match[2], opType: "inc" });
    }

    while ((match = rmPattern.exec(text)) !== null) {
      ops.push({ key: match[2], opType: "rm" });
    }

    return ops;
  };

  const flagOps = extractFlagOps(parsed.narrative);

  if (flagOps.length === 0) {
    return null;
  }

  const notifications = flagOps
    .filter((op) => {
      const key = op.key;
      return (
        key.startsWith("met_") ||
        key.startsWith("rapport_") ||
        FLAG_LABELS.hasOwnProperty(key)
      );
    })
    .map((op) => {
      const label = FLAG_LABELS[op.key] || `${op.opType} ${op.key}`;
      const color =
        op.opType === "inc"
          ? "bg-green-600/20 text-green-300"
          : op.opType === "set"
            ? "bg-blue-600/20 text-blue-300"
            : "bg-red-600/20 text-red-300";

      return (
        <div
          key={op.key}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-sm font-medium ${color} mb-2 animate-fade-in`}
        >
          <span>{label}</span>
        </div>
      );
    });

  return <div className="flex flex-wrap gap-2 mt-3 mb-2">{notifications}</div>;
}

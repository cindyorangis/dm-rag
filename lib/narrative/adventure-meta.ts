export type AdventureSlug =
  | "lost-mine-of-phandelver"
  | "ghosts-of-saltmarsh"
  | "tales-from-the-yawning-portal";

export interface AdventureMeta {
  title: string;
  setting: string;
  tone: string;
}

export const ADVENTURE_META: Record<AdventureSlug, AdventureMeta> = {
  "lost-mine-of-phandelver": {
    title: "Lost Mine of Phandelver",
    setting:
      "the Sword Coast frontier town of Phandalin in the Forgotten Realms",
    tone: "dramatic, atmospheric, occasionally darkly humorous. Channel classic D&D.",
  },
  "ghosts-of-saltmarsh": {
    title: "Ghosts of Saltmarsh",
    setting:
      "the coastal town of Saltmarsh on the Azure Sea in the world of Greyhawk",
    tone: "nautical and gothic, with an undercurrent of dread. Salt, rot, and old secrets.",
  },
  "tales-from-the-yawning-portal": {
    title: "Tales from the Yawning Portal",
    setting:
      "the Yawning Portal tavern in Waterdeep, gateway to classic dungeons across the Forgotten Realms",
    tone: "legendary and epic. These are the most dangerous dungeons ever delved. Treat them with weight.",
  },
};

const DEFAULT_SLUG: AdventureSlug = "lost-mine-of-phandelver";

export function getAdventureMeta(
  slug: string | undefined | null,
): AdventureMeta {
  return (
    ADVENTURE_META[(slug as AdventureSlug) ?? DEFAULT_SLUG] ??
    ADVENTURE_META[DEFAULT_SLUG]
  );
}

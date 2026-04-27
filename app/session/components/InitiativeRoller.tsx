import { useState } from "react";

export default function InitiativeRoller({
  dexMod,
  onRoll,
}: {
  dexMod: number;
  onRoll: (total: number) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [result, setResult] = useState<{
    natural: number;
    total: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const handleRoll = () => {
    if (rolling || result) return;
    setRolling(true);
    let ticks = 0;
    const interval = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * 20) + 1);
      ticks++;
      if (ticks > 16) {
        clearInterval(interval);
        const natural = Math.floor(Math.random() * 20) + 1;
        setDisplayNum(natural);
        setResult({ natural, total: natural + dexMod });
        setRolling(false);
      }
    }, 50);
  };

  const handleConfirm = () => {
    if (!result || confirmed) return;
    setConfirmed(true);
    setTimeout(() => onRoll(result.total), 350);
  };

  return (
    <div
      className={`mx-auto my-4 max-w-3xl space-y-4 rounded-lg border p-5 transition-all duration-500 ${
        confirmed
          ? "border-amber-700/20 bg-stone-900/20 opacity-40"
          : "border-amber-500/60 bg-gradient-to-b from-amber-950/30 to-stone-900/50"
      }`}
    >
      <div className="flex items-center gap-3">
        <div className="h-8 w-px bg-amber-600/60" />
        <div>
          <p className="font-serif text-base text-amber-200">
            Roll for Initiative!
          </p>
          <p className="mt-0.5 text-sm text-stone-300/85">
            d20 {dexMod >= 0 ? `+ ${dexMod}` : `- ${Math.abs(dexMod)}`} (DEX
            modifier)
          </p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`flex h-16 w-16 items-center justify-center rounded-lg border-2 font-serif text-2xl font-bold transition-all select-none ${
            result
              ? result.natural === 20
                ? "border-yellow-400 bg-yellow-950/40 text-yellow-300"
                : result.natural === 1
                  ? "border-red-700 bg-red-950/40 text-red-300"
                  : "border-amber-600/60 bg-amber-950/20 text-amber-200"
              : rolling
                ? "cursor-wait border-amber-700/80 bg-amber-950/30 text-amber-300 animate-pulse"
                : "cursor-pointer border-stone-600 bg-stone-800/60 text-stone-300 hover:border-amber-600/70 hover:text-amber-200 active:scale-95"
          }`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-60" : ""}>{displayNum}</span>
          ) : (
            <span className="text-lg text-stone-300">d20</span>
          )}
        </button>

        <div className="flex-1">
          {result ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-serif text-3xl font-bold ${
                    result.natural === 20
                      ? "text-yellow-300"
                      : result.natural === 1
                        ? "text-red-300"
                        : "text-amber-200"
                  }`}
                >
                  {result.total}
                </span>
                <span className="text-base text-stone-300/85">
                  ({result.natural} {dexMod >= 0 ? "+" : ""}
                  {dexMod})
                </span>
              </div>
              {result.natural === 20 && (
                <p className="font-serif text-sm italic text-yellow-300">
                  Natural 20 - you go first!
                </p>
              )}
              {result.natural === 1 && (
                <p className="font-serif text-sm italic text-red-300">
                  A poor start...
                </p>
              )}
            </div>
          ) : (
            <p className="font-serif text-base italic text-stone-300/85">
              {rolling ? "Rolling..." : "Click the die to roll"}
            </p>
          )}
        </div>

        {result && !confirmed && (
          <button
            onClick={handleConfirm}
            className="rounded bg-amber-700 px-4 py-2 text-sm text-white transition-colors hover:bg-amber-600"
          >
            Set Initiative
          </button>
        )}

        {confirmed && (
          <span className="font-serif text-sm italic text-amber-200/80">
            Locked in
          </span>
        )}
      </div>
    </div>
  );
}

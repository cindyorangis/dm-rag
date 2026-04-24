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
      className={`my-4 max-w-2xl mx-auto border rounded-lg p-5 space-y-4 transition-all duration-500 ${confirmed ? "border-amber-700/20 bg-stone-900/20 opacity-40" : "border-amber-700/60 bg-gradient-to-b from-amber-950/30 to-stone-900/50"}`}
    >
      <div className="flex items-center gap-3">
        <div className="w-px h-8 bg-amber-800/40" />
        <div>
          <p className="font-serif text-amber-300 text-sm">
            Roll for Initiative!
          </p>
          <p className="text-stone-500 text-xs mt-0.5">
            d20 {dexMod >= 0 ? `+ ${dexMod}` : `− ${Math.abs(dexMod)}`} (DEX
            modifier)
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`w-16 h-16 rounded-lg border-2 flex items-center justify-center font-serif text-2xl font-bold transition-all select-none ${result ? (result.natural === 20 ? "border-yellow-400 bg-yellow-950/40 text-yellow-300" : result.natural === 1 ? "border-red-700 bg-red-950/40 text-red-400" : "border-amber-600/60 bg-amber-950/20 text-amber-200") : rolling ? "border-amber-700/80 bg-amber-950/30 text-amber-300 animate-pulse cursor-wait" : "border-stone-600 bg-stone-800/60 text-stone-400 hover:border-amber-600/70 hover:text-amber-300 cursor-pointer active:scale-95"}`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-60" : ""}>{displayNum}</span>
          ) : (
            <span className="text-stone-500 text-lg">d20</span>
          )}
        </button>
        <div className="flex-1">
          {result ? (
            <div>
              <div className="flex items-baseline gap-2">
                <span
                  className={`font-serif text-3xl font-bold ${result.natural === 20 ? "text-yellow-300" : result.natural === 1 ? "text-red-400" : "text-amber-200"}`}
                >
                  {result.total}
                </span>
                <span className="text-stone-500 text-sm">
                  ({result.natural} {dexMod >= 0 ? "+" : ""}
                  {dexMod})
                </span>
              </div>
              {result.natural === 20 && (
                <p className="text-yellow-400/80 text-xs font-serif italic">
                  ✦ Natural 20 — you go first!
                </p>
              )}
              {result.natural === 1 && (
                <p className="text-red-400/70 text-xs font-serif italic">
                  A poor start…
                </p>
              )}
            </div>
          ) : (
            <p className="text-stone-600 font-serif italic text-sm">
              {rolling ? "Rolling…" : "Click the die to roll"}
            </p>
          )}
        </div>
        {result && !confirmed && (
          <button
            onClick={handleConfirm}
            className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm font-serif rounded transition-colors"
          >
            Set Initiative →
          </button>
        )}
        {confirmed && (
          <span className="text-amber-600/60 text-xs font-serif italic">
            Locked in
          </span>
        )}
      </div>
    </div>
  );
}

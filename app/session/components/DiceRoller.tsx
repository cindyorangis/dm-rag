import { useState } from "react";
import type { RollRequest } from "@/hooks/useChat";

function parseDiceExpression(expr: string): { sides: number; mod: number } {
  const m = expr.match(/d(\d+)([+-]\d+)?/i);
  if (!m) return { sides: 20, mod: 0 };
  return { sides: parseInt(m[1]), mod: parseInt(m[2] ?? "0") };
}

export default function DiceRoller({
  request,
  onResult,
}: {
  request: RollRequest;
  onResult: (resultText: string) => void;
}) {
  const [rolling, setRolling] = useState(false);
  const [displayNum, setDisplayNum] = useState<number | null>(null);
  const [result, setResult] = useState<{
    natural: number;
    total: number;
  } | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const { sides, mod } = parseDiceExpression(request.dice);

  const handleRoll = () => {
    if (rolling || result) return;
    setRolling(true);
    let ticks = 0;
    const interval = setInterval(() => {
      setDisplayNum(Math.floor(Math.random() * sides) + 1);
      ticks++;
      if (ticks > 14) {
        clearInterval(interval);
        const natural = Math.floor(Math.random() * sides) + 1;
        setDisplayNum(natural);
        setResult({ natural, total: natural + mod });
        setRolling(false);
      }
    }, 55);
  };

  const handleConfirm = () => {
    if (!result || confirmed) return;
    setConfirmed(true);
    let resultText = "";
    if (request.type === "attack" && request.targetAC !== undefined) {
      const hit = result.total >= request.targetAC;
      resultText = `Attack roll: ${result.natural} + ${mod} = ${result.total} vs AC ${request.targetAC} — ${hit ? "HIT!" : "MISS."}`;
    } else if (request.type === "check" || request.type === "save") {
      const success = request.dc !== undefined && result.total >= request.dc;
      resultText = `${request.label}: ${result.natural} + ${mod} = ${result.total} vs DC ${request.dc} — ${success ? "Success!" : "Failure."}`;
    } else {
      resultText = `${request.label}: rolled ${result.total} (${result.natural}${mod >= 0 ? "+" : ""}${mod})`;
    }
    setTimeout(() => onResult(resultText), 350);
  };

  const isCrit = result?.natural === sides;
  const isFumble = result?.natural === 1 && sides === 20;

  return (
    <div
      className={`border rounded-lg p-4 space-y-3 transition-all duration-500 ${confirmed ? "border-amber-700/20 bg-stone-900/20 opacity-40" : "border-amber-700/50 bg-gradient-to-b from-amber-950/25 to-stone-900/40"}`}
    >
      <div className="flex items-center gap-2">
        <span className="text-[0.55rem] tracking-widest uppercase text-amber-800/70 font-sans bg-amber-950/30 border border-amber-900/40 px-2 py-0.5 rounded">
          {request.type}
        </span>
        <span className="text-stone-400 font-serif text-sm">
          {request.label}
        </span>
      </div>
      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`w-14 h-14 rounded-lg border-2 flex items-center justify-center font-serif text-xl font-bold transition-all select-none shrink-0 ${result ? (isCrit ? "border-yellow-400 bg-yellow-950/40 text-yellow-300" : isFumble ? "border-red-700 bg-red-950/40 text-red-400" : "border-amber-600/50 bg-amber-950/20 text-amber-200") : rolling ? "border-amber-700/60 bg-amber-950/20 text-amber-400 animate-pulse cursor-wait" : "border-stone-600 bg-stone-800/50 text-stone-400 hover:border-amber-600/60 hover:text-amber-300 hover:bg-amber-950/15 cursor-pointer active:scale-95"}`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-50" : ""}>{displayNum}</span>
          ) : (
            <span className="text-stone-500 text-sm">d{sides}</span>
          )}
        </button>
        <div className="flex-1 min-w-0">
          {result ? (
            <div className="space-y-0.5">
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={`font-serif text-2xl font-bold ${isCrit ? "text-yellow-300" : isFumble ? "text-red-400" : "text-amber-200"}`}
                >
                  {result.total}
                </span>
                <span className="text-stone-500 text-xs font-sans">
                  ({result.natural} {mod >= 0 ? "+" : ""}
                  {mod})
                </span>
                {request.targetAC !== undefined && (
                  <span
                    className={`text-xs font-serif ${result.total >= request.targetAC ? "text-emerald-400" : "text-red-400"}`}
                  >
                    {result.total >= request.targetAC ? "✓ HIT" : "✗ MISS"}
                  </span>
                )}
                {(request.type === "check" || request.type === "save") &&
                  request.dc !== undefined && (
                    <span
                      className={`text-xs font-serif ${result.total >= request.dc ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {result.total >= request.dc ? "✓ SUCCESS" : "✗ FAIL"}
                    </span>
                  )}
              </div>
              {isCrit && (
                <p className="text-yellow-400/80 text-xs font-serif italic">
                  ✦ Critical hit!
                </p>
              )}
              {isFumble && (
                <p className="text-red-400/70 text-xs font-serif italic">
                  A fumble…
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
            className="px-3 py-2 bg-amber-700 hover:bg-amber-600 text-white text-xs font-serif rounded transition-colors shrink-0"
          >
            Confirm →
          </button>
        )}
        {confirmed && (
          <span className="text-amber-700/50 text-xs font-serif italic shrink-0">
            Sent
          </span>
        )}
      </div>
    </div>
  );
}

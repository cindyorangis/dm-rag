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
      resultText = `Attack roll: ${result.natural} + ${mod} = ${result.total} vs AC ${request.targetAC} - ${hit ? "HIT!" : "MISS."}`;
    } else if (request.type === "check" || request.type === "save") {
      const success = request.dc !== undefined && result.total >= request.dc;
      resultText = `${request.label}: ${result.natural} + ${mod} = ${result.total} vs DC ${request.dc} - ${success ? "Success!" : "Failure."}`;
    } else {
      resultText = `${request.label}: rolled ${result.total} (${result.natural}${mod >= 0 ? "+" : ""}${mod})`;
    }

    setTimeout(() => onResult(resultText), 350);
  };

  const isCrit = result?.natural === sides;
  const isFumble = result?.natural === 1 && sides === 20;

  return (
    <div
      className={`space-y-3 rounded-lg border p-4 transition-all duration-500 ${
        confirmed
          ? "border-amber-700/20 bg-stone-900/20 opacity-40"
          : "border-amber-500/60 bg-gradient-to-b from-amber-950/25 to-stone-900/40"
      }`}
    >
      <div className="flex items-center gap-2">
        <span className="rounded border border-amber-700/60 bg-amber-950/30 px-2 py-0.5 text-[0.7rem] uppercase tracking-[0.12em] text-amber-200">
          {request.type}
        </span>
        <span className="font-serif text-base text-stone-100">
          {request.label}
        </span>
      </div>

      <div className="flex items-center gap-4">
        <button
          onClick={handleRoll}
          disabled={!!result || rolling}
          className={`h-14 w-14 shrink-0 select-none rounded-lg border-2 font-serif text-xl font-bold transition-all ${
            result
              ? isCrit
                ? "border-yellow-400 bg-yellow-950/40 text-yellow-300"
                : isFumble
                  ? "border-red-700 bg-red-950/40 text-red-300"
                  : "border-amber-600/50 bg-amber-950/20 text-amber-200"
              : rolling
                ? "cursor-wait border-amber-700/60 bg-amber-950/20 text-amber-300 animate-pulse"
                : "cursor-pointer border-stone-600 bg-stone-800/50 text-stone-300 hover:border-amber-600/60 hover:bg-amber-950/15 hover:text-amber-200 active:scale-95"
          }`}
        >
          {displayNum !== null ? (
            <span className={rolling ? "opacity-50" : ""}>{displayNum}</span>
          ) : (
            <span className="text-sm text-stone-300">d{sides}</span>
          )}
        </button>

        <div className="min-w-0 flex-1">
          {result ? (
            <div className="space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-2">
                <span
                  className={`font-serif text-2xl font-bold ${
                    isCrit
                      ? "text-yellow-300"
                      : isFumble
                        ? "text-red-300"
                        : "text-amber-200"
                  }`}
                >
                  {result.total}
                </span>
                <span className="text-sm text-stone-300/85">
                  ({result.natural} {mod >= 0 ? "+" : ""}
                  {mod})
                </span>

                {request.targetAC !== undefined && (
                  <span
                    className={`text-sm font-serif ${
                      result.total >= request.targetAC
                        ? "text-emerald-300"
                        : "text-red-300"
                    }`}
                  >
                    {result.total >= request.targetAC ? "HIT" : "MISS"}
                  </span>
                )}

                {(request.type === "check" || request.type === "save") &&
                  request.dc !== undefined && (
                    <span
                      className={`text-sm font-serif ${
                        result.total >= request.dc
                          ? "text-emerald-300"
                          : "text-red-300"
                      }`}
                    >
                      {result.total >= request.dc ? "SUCCESS" : "FAIL"}
                    </span>
                  )}
              </div>

              {isCrit && (
                <p className="font-serif text-sm italic text-yellow-300">
                  Critical hit!
                </p>
              )}
              {isFumble && (
                <p className="font-serif text-sm italic text-red-300">
                  A fumble...
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
            className="shrink-0 rounded bg-amber-700 px-3 py-2 font-serif text-sm text-white transition-colors hover:bg-amber-600"
          >
            Confirm
          </button>
        )}

        {confirmed && (
          <span className="shrink-0 font-serif text-sm italic text-amber-200/80">
            Sent
          </span>
        )}
      </div>
    </div>
  );
}

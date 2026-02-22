import type { ScatterMove } from "@/types/radix"

const DIGIT_STROKE = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

type ScatterViewProps = {
  inputKeys: number[]
  inputValues: number[]
  digits: number[]
  outputKeys: number[]
  outputValues: number[]
  outputDigits?: number[]
  scatterMap: ScatterMove[]
}

export function ScatterView({
  inputKeys,
  inputValues,
  digits,
  outputKeys,
  outputValues,
  outputDigits = [],
  scatterMap,
}: ScatterViewProps) {
  const cardW = 76
  const gap = 8
  const totalW = inputKeys.length * (cardW + gap) - gap
  const x = (i: number) => cardW / 2 + i * (cardW + gap)
  const y1 = 2
  const y2 = 94
  const c = 36

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">keysIn read → keysOut written</div>
      <div className="overflow-x-auto">
        <div className="space-y-1" style={{ width: `${totalW}px` }}>
          <div className="flex gap-2">
            {inputKeys.map((k, i) => (
              <div
                key={`in-${i}`}
                className="rounded-md border-2 px-2 py-1 text-center text-sm font-semibold"
                style={{
                  width: `${cardW}px`,
                  borderColor: DIGIT_STROKE[digits[i]],
                  background: "#f8fafc",
                }}
              >
                {k}
                <div className="text-[10px] text-slate-500">#{inputValues[i]}</div>
              </div>
            ))}
          </div>
          <svg width={totalW} height={96} viewBox={`0 0 ${totalW} 96`} className="block">
            {scatterMap.map((m) => (
              <path
                key={`${m.from}-${m.dest}`}
                d={`M ${x(m.from)} ${y1} C ${x(m.from)} ${y1 + c} ${x(m.dest)} ${y2 - c} ${x(m.dest)} ${y2}`}
                stroke={DIGIT_STROKE[m.digit]}
                strokeWidth={1.5}
                fill="none"
                opacity={0.85}
              />
            ))}
          </svg>
          <div className="flex gap-2">
            {outputKeys.map((k, i) => (
              <div
                key={`out-${i}`}
                className="rounded-md border-2 bg-white px-2 py-1 text-center text-sm font-semibold"
                style={{
                  width: `${cardW}px`,
                  borderColor: outputDigits[i] != null ? DIGIT_STROKE[outputDigits[i]] : "#cbd5e1",
                }}
              >
                {k}
                <div className="text-[10px] text-slate-500">#{outputValues[i]}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

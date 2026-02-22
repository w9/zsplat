import { useState } from "react"
import type { ScatterMove } from "@/types/radix"

const DIGIT_STROKE = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

type ScatterViewProps = {
  inputKeys: number[]
  inputValues: number[]
  digits: number[]
  outputKeys: Array<number | null>
  outputValues: Array<number | null>
  outputSourceByDest?: Array<number | null>
  outputDigits?: number[]
  scatterMap: ScatterMove[]
  connectorMap?: ScatterMove[]
  numWGs?: number
  tileSize?: number
  title?: string
  cumOffsets?: number[][]
  activeFromIndices?: number[]
  activeDestIndices?: number[]
  processedFromIndices?: number[]
  processedDestIndices?: number[]
  highlightWorkgroup?: number | null
  onHoverWorkgroupChange?: (wg: number | null) => void
  showActivity?: boolean
}

export function ScatterView({
  inputKeys,
  inputValues,
  digits,
  outputKeys,
  outputValues,
  outputSourceByDest = [],
  outputDigits = [],
  scatterMap,
  connectorMap,
  numWGs = 1,
  tileSize = inputKeys.length,
  title = "keysIn read → keysOut written",
  cumOffsets = [],
  activeFromIndices,
  activeDestIndices,
  processedFromIndices,
  processedDestIndices,
  highlightWorkgroup = null,
  onHoverWorkgroupChange,
  showActivity = true,
}: ScatterViewProps) {
  const [hoveredWG, setHoveredWG] = useState<number | null>(null)
  const cardW = 76
  const gap = 8
  const totalW = inputKeys.length * (cardW + gap) - gap
  const padX = 32
  const plotW = totalW + padX * 2
  const x = (i: number) => padX + cardW / 2 + i * (cardW + gap)
  const tickX = (index: number) => {
    if (index <= 0) return padX
    if (index >= inputKeys.length) return padX + totalW
    return padX + index * (cardW + gap) - gap / 2
  }
  const y1 = 2
  const y2 = 94
  const c = 36
  const connectors = connectorMap ?? scatterMap
  const activeFrom = new Set((activeFromIndices ?? scatterMap.map((m) => m.from)).filter((i) => i >= 0 && i < inputKeys.length))
  const activeDest = new Set((activeDestIndices ?? scatterMap.map((m) => m.dest)).filter((i) => i >= 0 && i < outputKeys.length))
  const processedFrom = new Set((processedFromIndices ?? []).filter((i) => i >= 0 && i < inputKeys.length))
  const processedDest = new Set((processedDestIndices ?? []).filter((i) => i >= 0 && i < outputKeys.length))
  const cumOffsetTicks = cumOffsets.flatMap((wgOffsets, wg) => wgOffsets.map((index, digit) => ({ wg, digit, index })))
  const tickStacks = new Map<number, number>()
  const stackedTicks = cumOffsetTicks.map((tick) => {
    const stack = tickStacks.get(tick.index) ?? 0
    tickStacks.set(tick.index, stack + 1)
    return { ...tick, stack }
  })
  const maxStack = stackedTicks.reduce((m, t) => Math.max(m, t.stack + 1), 0)
  const tickRowH = 30
  const cardWG = (index: number) => Math.floor(index / tileSize)
  const outputCardWG = (index: number) => {
    const sourceIndex = outputSourceByDest[index]
    return sourceIndex == null ? cardWG(index) : Math.floor(sourceIndex / tileSize)
  }
  const setHoverWG = (wg: number | null) => {
    setHoveredWG(wg)
    onHoverWorkgroupChange?.(wg)
  }
  const effectiveHighlightWG = hoveredWG ?? highlightWorkgroup
  const isHighlightedWG = (wg: number) => effectiveHighlightWG == null || wg === effectiveHighlightWG
  const dimmedOpacity = 0.15

  return (
    <div className="space-y-2">
      <div className="text-sm font-medium">{title}</div>
      <div className="flex flex-wrap gap-2 text-[11px] text-slate-600">
        {Array.from({ length: numWGs }, (_, wg) => {
          const start = wg * tileSize
          const end = Math.min(start + tileSize, inputKeys.length) - 1
          return (
            <span
              key={`wg-${wg}`}
              className="rounded px-2 py-0.5"
              style={{
                background: isHighlightedWG(wg) ? "#e2e8f0" : "#f1f5f9",
                opacity: isHighlightedWG(wg) ? 1 : 0.55,
              }}
              onMouseEnter={() => setHoverWG(wg)}
              onMouseLeave={() => setHoverWG(null)}
            >
              WG{wg}: idx {start}-{Math.max(start, end)}
            </span>
          )
        })}
      </div>
      <div className="overflow-x-auto overflow-y-visible py-1">
        <div className="space-y-1" style={{ width: `${plotW}px` }}>
          <div className="flex gap-2" style={{ paddingLeft: `${padX}px`, paddingRight: `${padX}px` }}>
              {inputKeys.map((k, i) => (
                (() => {
                  const isActive = activeFrom.has(i)
                  const isProcessed = !isActive && processedFrom.has(i)
                  return (
                <div
                  key={`in-${i}`}
                  className="rounded-md border-2 px-2 py-1 text-center text-sm font-semibold"
                  style={{
                    width: `${cardW}px`,
                    borderColor: DIGIT_STROKE[digits[i]],
                  background: showActivity && isActive ? `${DIGIT_STROKE[digits[i]]}55` : showActivity && isProcessed ? "#f8fafc" : "#ffffff",
                  opacity: isHighlightedWG(cardWG(i)) ? (showActivity ? (isActive ? 1 : isProcessed ? 0.6 : 0.15) : 1) : dimmedOpacity,
                  boxShadow: showActivity && isActive ? "0 0 0 3px rgba(15,23,42,0.28)" : "none",
                  }}
                  onMouseEnter={() => setHoverWG(cardWG(i))}
                  onMouseLeave={() => setHoverWG(null)}
                >
                  {k}
                  <div className="text-[10px] text-slate-500">v={inputValues[i]}</div>
                </div>
                  )
                })()
              ))}
          </div>
          <svg width={plotW} height={96} viewBox={`0 0 ${plotW} 96`} className="block">
            {connectors.map((m) => (
              <path
                key={`${m.from}-${m.dest}`}
                d={`M ${x(m.from)} ${y1} C ${x(m.from)} ${y1 + c} ${x(m.dest)} ${y2 - c} ${x(m.dest)} ${y2}`}
                stroke={DIGIT_STROKE[m.digit]}
                strokeWidth={1.5}
                fill="none"
                opacity={isHighlightedWG(m.wg ?? cardWG(m.from)) ? 0.85 : 0.12}
                onMouseEnter={() => setHoverWG(m.wg ?? cardWG(m.from))}
                onMouseLeave={() => setHoverWG(null)}
              />
            ))}
          </svg>
          <div className="flex gap-2" style={{ paddingLeft: `${padX}px`, paddingRight: `${padX}px` }}>
              {outputKeys.map((k, i) => (
                (() => {
                  const isActive = activeDest.has(i)
                  const isProcessed = !isActive && (processedDest.has(i) || outputValues[i] != null)
                  return (
                <div
                  key={`out-${i}`}
                  className="rounded-md border-2 bg-white px-2 py-1 text-center text-sm font-semibold"
                  style={{
                    width: `${cardW}px`,
                    borderColor: outputDigits[i] != null && outputDigits[i] >= 0 ? DIGIT_STROKE[outputDigits[i]] : "#cbd5e1",
                  background: showActivity
                    ? isActive && outputDigits[i] != null && outputDigits[i] >= 0
                      ? `${DIGIT_STROKE[outputDigits[i]]}55`
                      : isActive
                        ? "#f8fafc"
                        : isProcessed
                          ? "#f8fafc"
                          : "#ffffff"
                    : "#ffffff",
                  opacity: isHighlightedWG(outputCardWG(i)) ? (showActivity ? (isActive ? 1 : isProcessed ? 0.6 : 0.15) : 1) : dimmedOpacity,
                  boxShadow: showActivity && isActive ? "0 0 0 3px rgba(15,23,42,0.28)" : "none",
                  }}
                  onMouseEnter={() => setHoverWG(outputCardWG(i))}
                  onMouseLeave={() => setHoverWG(null)}
                >
                  {k ?? "·"}
                  <div className="text-[10px] text-slate-500">{outputValues[i] == null ? "\u00A0" : `v=${outputValues[i]}`}</div>
                </div>
                  )
                })()
              ))}
          </div>
          {stackedTicks.length > 0 && (
            <div className="relative mt-1" style={{ height: `${maxStack * tickRowH + 11}px` }}>
              {stackedTicks.map((tick) => (
                <div
                  key={`tick-${tick.wg}-${tick.digit}-${tick.stack}`}
                  className="absolute -translate-x-1/2 text-[10px] text-slate-600"
                  style={{
                    left: `${tickX(tick.index)}px`,
                    top: `${tick.stack * tickRowH}px`,
                    opacity: isHighlightedWG(tick.wg) ? 1 : 0.2,
                  }}
                  onMouseEnter={() => setHoverWG(tick.wg)}
                  onMouseLeave={() => setHoverWG(null)}
                >
                  <div className="mx-auto h-2 w-px bg-slate-500" />
                  <div
                    className="whitespace-nowrap rounded border px-1 py-0.5 font-medium text-slate-700"
                    style={{
                      borderColor: DIGIT_STROKE[tick.digit],
                      backgroundColor: `${DIGIT_STROKE[tick.digit]}33`,
                    }}
                  >
                    WG{tick.wg} d={tick.digit}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

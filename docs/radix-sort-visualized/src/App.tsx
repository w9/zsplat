import { type ReactElement, useEffect, useMemo, useRef, useState } from "react"
import { InputControls } from "@/components/controls/InputControls"
import { StepControls } from "@/components/controls/StepControls"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { BufferStrip } from "@/components/viz/BufferStrip"
import { CumOffsetView } from "@/components/viz/CumOffsetView"
import { ExplanationPanel } from "@/components/viz/ExplanationPanel"
import { ScatterView } from "@/components/viz/ScatterView"
import { NUM_PASSES, RADIX, VIZ_ELEMENTS_PER_THREAD, VIZ_TILE_SIZE, VIZ_WG_SIZE, type ScatterMove, type Snapshot } from "@/types/radix"
import { parseInput, precomputeSnapshots, randomInput } from "@/lib/radix"

const DIGIT_COLORS = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

const EXPLANATIONS: Record<number, string> = {
  0: "Per-thread: each lane reads one key and extracts the active 2-bit digit. Per-WG: lanes are grouped into tiles. Global: keysIn/valsIn are unchanged.",
  1: "Per-WG assignment: keysIn is partitioned into fixed tiles. Each dashed box is one WG's ownership range for this pass.",
  2: "Per-thread: increment local digit counts. Per-WG: each WG builds its local histogram over its tile. Global: these local counts are the source for histBuf writes.",
  3: "Per-thread: write WG-local counts into global histBuf at index digit*numWGs + wg. Per-WG: one column per WG. Global: histBuf now contains all WG contributions.",
  4: "Per-thread: prefix-sum kernel scans the flattened histBuf in place. Per-WG: no ownership, this step is global. Global: histBuf entries become exclusive starts used by scatter.",
  5: "Wave 0 pre-scatter: lanes load base offsets from histBuf into WG-local cumOffset[d]. No writes yet; all current cumOffset values are shown.",
  6: "Wave 0 scatter: each lane writes using cumOffset[d] + rank(lanes with same digit and smaller lid).",
  7: "Wave 1 pre-scatter: cumOffset is updated by adding wave-0 per-digit counts (from sharedDigits), so each digit points to its next free output slot before wave 1 writes.",
  8: "Wave 1 scatter: same deterministic rank rule, now using the updated cumOffset values.",
  9: "All waves complete: full stable scatter for this pass. Stability across WGs comes from non-overlapping prefix ranges in histBuf.",
  10: "Per-thread: done for this pass. Global: ping-pong swap makes keysOut/valsOut the next pass keysIn/valsIn.",
}

const IMPORTANT_CONSTANTS = [
  { name: "WG_SIZE", value: VIZ_WG_SIZE, explanation: "Threads per workgroup. Real code value: 256." },
  { name: "ELEMENTS_PER_THREAD", value: VIZ_ELEMENTS_PER_THREAD, explanation: "Elements processed per thread per pass. Real code value: 16." },
  { name: "TILE_SIZE", value: VIZ_TILE_SIZE, explanation: "Elements owned by one workgroup. Real code value: 4096." },
  { name: "RADIX", value: RADIX, explanation: "Digit buckets per pass. Real code value: 256." },
  { name: "NUM_PASSES", value: NUM_PASSES, explanation: "Total radix passes. Real code value: 4." },
]

function buildOutputDigits(length: number, moves: ScatterMove[] | null): number[] {
  const out = new Array<number>(length).fill(-1)
  if (!moves) return out
  for (const m of moves) out[m.dest] = m.digit
  return out
}

function buildPartialOutputsFromMoves(inputKeys: number[], inputValues: number[], moves: ScatterMove[]): { keys: Array<number | null>; values: Array<number | null> } {
  const keys = new Array<number | null>(inputKeys.length).fill(null)
  const values = new Array<number | null>(inputValues.length).fill(null)
  for (const m of moves) {
    keys[m.dest] = inputKeys[m.from]
    values[m.dest] = inputValues[m.from]
  }
  return { keys, values }
}

function buildSourceByDest(length: number, moves: ScatterMove[]): Array<number | null> {
  const out = new Array<number | null>(length).fill(null)
  for (const m of moves) out[m.dest] = m.from
  return out
}

function buildWaveInputIndices(length: number, numWGs: number, wave: number): number[] {
  return Array.from({ length: numWGs }, (_, wg) => Array.from({ length: VIZ_WG_SIZE }, (_, lid) => wg * VIZ_TILE_SIZE + wave * VIZ_WG_SIZE + lid))
    .flat()
    .filter((idx) => idx >= 0 && idx < length)
}

function getWaveScatterState(snapshot: Snapshot): {
  title: string
  moves: ScatterMove[]
  connectors?: ScatterMove[]
  outputKeys: Array<number | null>
  outputValues: Array<number | null>
  outputSourceByDest: Array<number | null>
  cumOffsets: number[][]
  showActivity?: boolean
  activeFromIndices?: number[]
  activeDestIndices?: number[]
  processedFromIndices?: number[]
  processedDestIndices?: number[]
} | null {
  if (snapshot.subStep < 5) return null

  if (snapshot.subStep === 5) {
    const numWGs = snapshot.numWGs ?? 1
    const activeFromIndices = buildWaveInputIndices(snapshot.inputKeys.length, numWGs, 0)
    return {
      title: "load cumOffset + wave 0 ready",
      moves: [],
      connectors: [],
      outputKeys: new Array(snapshot.inputKeys.length).fill(null),
      outputValues: new Array(snapshot.inputValues.length).fill(null),
      outputSourceByDest: new Array(snapshot.inputKeys.length).fill(null),
      cumOffsets: snapshot.cumOffsetInit ?? [],
      activeFromIndices,
    }
  }

  if (!snapshot.waveScatterMap) return null

  if (snapshot.subStep === 6) {
    const moves = snapshot.waveScatterMap[0] ?? []
    const partial = buildPartialOutputsFromMoves(snapshot.inputKeys, snapshot.inputValues, moves)
    return {
      title: "wave 0 writes (WG-aware scatter)",
      moves,
      connectors: moves,
      outputKeys: partial.keys,
      outputValues: partial.values,
      outputSourceByDest: buildSourceByDest(snapshot.inputKeys.length, moves),
      cumOffsets: snapshot.cumOffsetInit ?? [],
    }
  }

  if (snapshot.subStep === 7) {
    const numWGs = snapshot.numWGs ?? 1
    const activeFromIndices = buildWaveInputIndices(snapshot.inputKeys.length, numWGs, 1)
    const processedFromIndices = buildWaveInputIndices(snapshot.inputKeys.length, numWGs, 0)
    const wave0Moves = snapshot.waveScatterMap[0] ?? []
    return {
      title: "wave 1 pre-scatter (updated cumOffset)",
      moves: [],
      connectors: [],
      outputKeys: snapshot.partialOutputKeys ?? new Array(snapshot.inputKeys.length).fill(null),
      outputValues: snapshot.partialOutputValues ?? new Array(snapshot.inputValues.length).fill(null),
      outputSourceByDest: buildSourceByDest(snapshot.inputKeys.length, wave0Moves),
      cumOffsets: snapshot.cumOffsetAfterWave?.[0] ?? snapshot.cumOffsetInit ?? [],
      activeFromIndices,
      processedFromIndices,
      processedDestIndices: wave0Moves.map((m) => m.dest),
    }
  }

  if (snapshot.subStep === 8) {
    const wave0 = snapshot.waveScatterMap[0] ?? []
    const wave1 = snapshot.waveScatterMap[1] ?? []
    const moves = [...wave0, ...wave1]
    return {
      title: "wave 1 update (same diagram, expanded writes)",
      moves,
      connectors: wave1,
      outputKeys: snapshot.partialOutputKeys ?? new Array(snapshot.inputKeys.length).fill(null),
      outputValues: snapshot.partialOutputValues ?? new Array(snapshot.inputValues.length).fill(null),
      outputSourceByDest: buildSourceByDest(snapshot.inputKeys.length, moves),
      cumOffsets: snapshot.cumOffsetAfterWave?.[0] ?? snapshot.cumOffsetInit ?? [],
      activeFromIndices: wave1.map((m) => m.from),
      activeDestIndices: wave1.map((m) => m.dest),
      processedFromIndices: wave0.map((m) => m.from),
      processedDestIndices: wave0.map((m) => m.dest),
    }
  }

  return {
    title: "full scatter result (all waves)",
    moves: snapshot.scatterMap ?? [],
    connectors: snapshot.scatterMap ?? [],
    outputKeys: (snapshot.outputKeys ?? []).map((v) => v),
    outputValues: (snapshot.outputValues ?? []).map((v) => v),
    outputSourceByDest: buildSourceByDest(snapshot.inputKeys.length, snapshot.scatterMap ?? []),
    cumOffsets: snapshot.cumOffsetInit ?? [],
    showActivity: false,
  }
}

function renderStep(snapshot: Snapshot, hoveredWG: number | null, setHoveredWG: (wg: number | null) => void) {
  if (snapshot.stepName === "Sorted!" && snapshot.outputKeys && snapshot.outputValues) {
    return (
      <div className="space-y-4">
        <BufferStrip
          name="sorted keys"
          values={snapshot.outputKeys}
          metaValues={snapshot.outputValues}
          showDigitLabel={false}
        />
      </div>
    )
  }

  const bitOffset = snapshot.bitOffset ?? 0
  const subStep = snapshot.subStep
  const digits = snapshot.digits ?? []
  const values = snapshot.inputValues
  const numWGs = snapshot.numWGs ?? 1

  const sections: ReactElement[] = []

  sections.push(
    <BufferStrip
      key="keysIn-extract"
      name="keysIn"
      role="read"
      values={snapshot.inputKeys}
      metaValues={values}
      digits={digits}
      bitOffset={bitOffset}
      showBinary
      workgroupTiles={subStep >= 1 ? (snapshot.workgroupTiles ?? []) : []}
      showDigitLabel
      highlightWorkgroup={hoveredWG}
      onHoverWorkgroupChange={setHoveredWG}
    />,
  )

  if (subStep >= 2 && snapshot.localHistograms) {
    sections.push(
      <CumOffsetView
        key="local-hist"
        title="WG localHist [d0,d1,d2,d3]"
        values={snapshot.localHistograms}
        valueLabel="localHist[d]"
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
  }

  if (subStep >= 3 && snapshot.histBufBefore) {
    const histBufDigits = snapshot.histBufBefore.map((_, idx) => Math.floor(idx / numWGs))
    sections.push(
      <BufferStrip
        key="histbuf-before"
        name="histBuf before prefix (index = digit*numWGs + wg)"
        role="written"
        values={snapshot.histBufBefore}
        digits={histBufDigits}
        compact
        getWorkgroupForIndex={(idx) => idx % numWGs}
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
  }

  if (subStep >= 4 && snapshot.histBufAfter) {
    const histBufDigits = snapshot.histBufAfter.map((_, idx) => Math.floor(idx / numWGs))
    sections.push(
      <BufferStrip
        key="histbuf-after"
        name="histBuf after prefix (in-place exclusive starts)"
        role="written"
        values={snapshot.histBufAfter}
        digits={histBufDigits}
        compact
        getWorkgroupForIndex={(idx) => idx % numWGs}
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
  }

  const waveScatterState = getWaveScatterState(snapshot)
  if (waveScatterState) {
    const sharedWave = subStep >= 7 ? 1 : 0
    const sharedDigits =
      subStep >= 5 && snapshot.waveDigits
        ? snapshot.waveDigits.map((wgWaves) => {
            const idx = Math.min(sharedWave, Math.max(0, wgWaves.length - 1))
            return wgWaves[idx] ?? []
          })
        : undefined
    sections.push(
      <CumOffsetView
        key="cumoffset-scatter"
        title={`WG buffers (wave ${sharedWave} sharedDigits + cumOffset)`}
        values={waveScatterState.cumOffsets}
        sharedDigits={sharedDigits}
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
    sections.push(
      <ScatterView
        key="scatter-progress"
        title={waveScatterState.title}
        inputKeys={snapshot.inputKeys}
        inputValues={values}
        digits={digits}
        outputKeys={waveScatterState.outputKeys}
        outputValues={waveScatterState.outputValues}
        outputSourceByDest={waveScatterState.outputSourceByDest}
        outputDigits={buildOutputDigits(snapshot.inputKeys.length, waveScatterState.moves)}
        scatterMap={waveScatterState.moves}
        connectorMap={waveScatterState.connectors}
        numWGs={numWGs}
        tileSize={VIZ_TILE_SIZE}
        cumOffsets={waveScatterState.cumOffsets}
        showActivity={waveScatterState.showActivity ?? true}
        activeFromIndices={waveScatterState.activeFromIndices}
        activeDestIndices={waveScatterState.activeDestIndices}
        processedFromIndices={waveScatterState.processedFromIndices}
        processedDestIndices={waveScatterState.processedDestIndices}
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
  }

  if (subStep >= 10 && snapshot.outputKeys && snapshot.outputValues) {
    const outputDigits = buildOutputDigits(snapshot.inputKeys.length, snapshot.scatterMap)
    sections.push(
      <BufferStrip
        key="keysOut"
        name="keysOut"
        role="written"
        values={snapshot.outputKeys}
        metaValues={snapshot.outputValues}
        digits={outputDigits}
        showDigitLabel={false}
        getWorkgroupForIndex={(idx) => {
          const sourceIndex = snapshot.outputValues?.[idx]
          return sourceIndex == null ? Math.floor(idx / VIZ_TILE_SIZE) : Math.floor(sourceIndex / VIZ_TILE_SIZE)
        }}
        highlightWorkgroup={hoveredWG}
        onHoverWorkgroupChange={setHoveredWG}
      />,
    )
  }

  if (sections.length) {
    return <div className="space-y-4">{sections}</div>
  }

  return null
}

export default function App() {
  const [inputArr, setInputArr] = useState<number[]>(() => randomInput(12))
  const [inputText, setInputText] = useState("")
  const [randomCount, setRandomCount] = useState(12)
  const [currentStep, setCurrentStep] = useState(0)
  const [hoveredWG, setHoveredWG] = useState<number | null>(null)
  const [showConstants, setShowConstants] = useState(false)
  const [shouldScrollBottom, setShouldScrollBottom] = useState(false)
  const bottomRef = useRef<HTMLDivElement | null>(null)

  const snapshots = useMemo(() => precomputeSnapshots(inputArr), [inputArr])
  const snapshot = snapshots[Math.min(currentStep, snapshots.length - 1)]

  useEffect(() => {
    setInputText(inputArr.join(", "))
  }, [inputArr])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCurrentStep((s) => Math.max(0, s - 1))
      if (e.key === "ArrowRight") {
        setCurrentStep((s) => Math.min(snapshots.length - 1, s + 1))
        setShouldScrollBottom(true)
      }
      if (e.key === "Home") setCurrentStep(0)
      if (e.key === "End") setCurrentStep(snapshots.length - 1)
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [snapshots.length])

  useEffect(() => {
    if (!shouldScrollBottom) return
    requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
      setShouldScrollBottom(false)
    })
  }, [currentStep, shouldScrollBottom])

  const passLabel = snapshot.stepName === "Sorted!" ? "Final" : `Pass ${snapshot.pass + 1}/${NUM_PASSES} (bits ${snapshot.bitOffset}-${(snapshot.bitOffset ?? 0) + 1})`
  const stepProgress = `${currentStep + 1} / ${snapshots.length}`
  const passProgress = `${passLabel} · ${stepProgress}`
  const explanation = snapshot.stepName === "Sorted!" ? "Final sorted output after all passes." : EXPLANATIONS[snapshot.subStep] ?? ""

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Stable Radix Sort Interactive Visualizer</CardTitle>
            <button
              type="button"
              className="w-fit rounded border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-slate-700 hover:bg-slate-50"
              onClick={() => setShowConstants((v) => !v)}
              aria-expanded={showConstants}
            >
              {showConstants ? "Hide important constants" : "Show important constants"}
            </button>
          </div>
          {showConstants && (
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-600">
              {IMPORTANT_CONSTANTS.map((item) => (
                <Tooltip key={item.name}>
                  <TooltipTrigger asChild>
                    <span
                      className="cursor-help font-mono text-[11px] font-semibold text-slate-800 underline decoration-dotted underline-offset-4"
                      aria-label={`${item.name} equals ${item.value}. ${item.explanation}`}
                    >
                      {item.name}={item.value}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent>{item.explanation}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          <InputControls
            value={inputText}
            onChange={setInputText}
            randomCount={randomCount}
            onRandomCountChange={(value) => setRandomCount(Math.min(256, Math.max(1, value)))}
            onRandomize={() => {
              const next = randomInput(randomCount)
              setInputArr(next)
              setCurrentStep(0)
            }}
            onApply={() => {
              const parsed = parseInput(inputText)
              setInputArr(parsed.length ? parsed : randomInput(randomCount))
              setCurrentStep(0)
            }}
          />
          {renderStep(snapshot, hoveredWG, setHoveredWG)}
          <ExplanationPanel
            stepTitle={snapshot.stepName}
            text={explanation}
            controls={
              <StepControls
                currentPass={Math.min(snapshot.pass, NUM_PASSES - 1)}
                numPasses={NUM_PASSES}
                passText={passProgress}
                onReset={() => setCurrentStep(0)}
                onPrev={() => setCurrentStep((s) => Math.max(0, s - 1))}
                onNext={() => {
                  setCurrentStep((s) => Math.min(snapshots.length - 1, s + 1))
                  setShouldScrollBottom(true)
                }}
                onEnd={() => setCurrentStep(snapshots.length - 1)}
              />
            }
            legend={
              <div className="flex items-center gap-4 text-xs text-slate-500">
                {DIGIT_COLORS.map((c, i) => (
                  <div key={i} className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                    <span>digit {i}</span>
                  </div>
                ))}
              </div>
            }
          />
          <div ref={bottomRef} />
        </CardContent>
      </Card>
    </main>
  )
}

import { type ReactElement, useEffect, useMemo, useRef, useState } from "react"
import { InputControls } from "@/components/controls/InputControls"
import { StepControls } from "@/components/controls/StepControls"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  7: "Wave 1 pre-scatter: cumOffset has advanced by wave 0 counts; all updated cumOffset values are shown before wave 1 writes.",
  8: "Wave 1 scatter: same deterministic rank rule, now using the updated cumOffset values.",
  9: "All waves complete: full stable scatter for this pass. Stability across WGs comes from non-overlapping prefix ranges in histBuf.",
  10: "Per-thread: done for this pass. Global: ping-pong swap makes keysOut/valsOut the next pass keysIn/valsIn.",
}

const IMPORTANT_CONSTANTS = [
  { name: "WG_SIZE", value: VIZ_WG_SIZE, explanation: "Threads per workgroup." },
  { name: "ELEMENTS_PER_THREAD", value: VIZ_ELEMENTS_PER_THREAD, explanation: "Elements processed per thread per pass." },
  { name: "TILE_SIZE", value: VIZ_TILE_SIZE, explanation: "Elements owned by one workgroup." },
  { name: "RADIX", value: RADIX, explanation: "Digit buckets per pass." },
  { name: "NUM_PASSES", value: NUM_PASSES, explanation: "Total radix passes." },
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
  cumOffsets: number[][]
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
    cumOffsets: snapshot.cumOffsetInit ?? [],
  }
}

function renderStep(snapshot: Snapshot) {
  if (snapshot.stepName === "Sorted!" && snapshot.outputKeys && snapshot.outputValues) {
    return (
      <div className="space-y-4">
        <BufferStrip name="sorted keys" values={snapshot.outputKeys} />
        <BufferStrip name="sorted values" values={snapshot.outputValues} compact />
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
      digits={digits}
      bitOffset={bitOffset}
      showBinary
      workgroupTiles={subStep >= 1 ? (snapshot.workgroupTiles ?? []) : []}
    />,
  )

  if (subStep >= 2 && snapshot.localHistograms) {
    snapshot.localHistograms.forEach((local, wg) => {
      sections.push(
        <BufferStrip
          key={`wg-local-hist-${wg}`}
          name={`WG${wg} localHist [d0,d1,d2,d3]`}
          role="written"
          values={local}
          digits={[0, 1, 2, 3]}
          compact
        />,
      )
    })
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
      />,
    )
  }

  const waveScatterState = getWaveScatterState(snapshot)
  if (waveScatterState) {
    const wave0SharedDigits = subStep >= 5 && snapshot.waveDigits ? snapshot.waveDigits.map((wgWaves) => wgWaves[0] ?? []) : undefined
    sections.push(
      <CumOffsetView
        key="cumoffset-scatter"
        title="WG buffers (sharedDigits + cumOffset)"
        values={waveScatterState.cumOffsets}
        sharedDigits={wave0SharedDigits}
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
        outputDigits={buildOutputDigits(snapshot.inputKeys.length, waveScatterState.moves)}
        scatterMap={waveScatterState.moves}
        connectorMap={waveScatterState.connectors}
        numWGs={numWGs}
        tileSize={VIZ_TILE_SIZE}
        cumOffsets={waveScatterState.cumOffsets}
        activeFromIndices={waveScatterState.activeFromIndices}
        activeDestIndices={waveScatterState.activeDestIndices}
        processedFromIndices={waveScatterState.processedFromIndices}
        processedDestIndices={waveScatterState.processedDestIndices}
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
        digits={outputDigits}
      />,
    )
    sections.push(<BufferStrip key="valsOut" name="valsOut" role="written" values={snapshot.outputValues} compact />)
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
                <span key={item.name} className="inline-flex items-center gap-2">
                  <span className="font-mono text-[11px] font-semibold text-slate-800">
                    {item.name}={item.value}
                  </span>
                  <span className="ml-2">{item.explanation}</span>
                </span>
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
          {renderStep(snapshot)}
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

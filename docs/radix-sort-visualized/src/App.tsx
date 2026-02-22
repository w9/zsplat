import { type ReactElement, useEffect, useMemo, useState } from "react"
import { InputControls } from "@/components/controls/InputControls"
import { StepControls } from "@/components/controls/StepControls"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { BufferStrip } from "@/components/viz/BufferStrip"
import { ExplanationPanel } from "@/components/viz/ExplanationPanel"
import { ScatterView } from "@/components/viz/ScatterView"
import { NUM_PASSES, type Snapshot } from "@/types/radix"
import { parseInput, precomputeSnapshots, randomInput } from "@/lib/radix"

const DIGIT_COLORS = ["#a6cee3", "#1f78b4", "#b2df8a", "#33a02c"]

const EXPLANATIONS: Record<number, string> = {
  0: "Read keysIn only and extract the current 2-bit digit (0..3) for each key.",
  1: "Count how many keys fall into each digit bucket.",
  2: "Convert counts into exclusive start offsets for each bucket.",
  3: "Write each key to output using its bucket offset plus per-digit rank.",
  4: "Use this output as the next pass input (ping-pong swap).",
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
  const outputDigits = new Array<number>(snapshot.inputKeys.length).fill(0)
  if (snapshot.scatterMap) {
    snapshot.scatterMap.forEach((m) => {
      outputDigits[m.dest] = m.digit
    })
  }

  const sections: ReactElement[] = []

  // Step 0 stays visible throughout the pass.
  sections.push(
    <BufferStrip
      key="keysIn-extract"
      name="keysIn"
      role="read"
      values={snapshot.inputKeys}
      digits={digits}
      bitOffset={bitOffset}
      showBinary
    />,
  )

  if (subStep >= 1 && snapshot.histogram) {
    sections.push(
      <BufferStrip
        key="histogram"
        name="histogram [d0,d1,d2,d3]"
        role="written"
        values={snapshot.histogram}
        digits={[0, 1, 2, 3]}
        compact
      />,
    )
  }

  if (subStep >= 2 && snapshot.prefixSum) {
    sections.push(
      <BufferStrip
        key="prefix-sum"
        name="prefixSum [d0,d1,d2,d3]"
        role="written"
        values={snapshot.prefixSum}
        digits={[0, 1, 2, 3]}
        compact
      />,
    )
  }

  if (subStep >= 3 && snapshot.scatterMap && snapshot.outputKeys && snapshot.outputValues) {
    sections.push(<BufferStrip key="valsIn" name="valsIn" role="read" values={values} compact />)
    sections.push(
      <ScatterView
        key="scatter"
        inputKeys={snapshot.inputKeys}
        inputValues={values}
        digits={digits}
        outputKeys={snapshot.outputKeys}
        outputValues={snapshot.outputValues}
        outputDigits={outputDigits}
        scatterMap={snapshot.scatterMap}
      />,
    )
  }

  if (subStep >= 4 && snapshot.outputKeys && snapshot.outputValues) {
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
  const [currentStep, setCurrentStep] = useState(0)

  const snapshots = useMemo(() => precomputeSnapshots(inputArr), [inputArr])
  const snapshot = snapshots[Math.min(currentStep, snapshots.length - 1)]

  useEffect(() => {
    setInputText(inputArr.join(", "))
  }, [inputArr])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") setCurrentStep((s) => Math.max(0, s - 1))
      if (e.key === "ArrowRight") setCurrentStep((s) => Math.min(snapshots.length - 1, s + 1))
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [snapshots.length])

  const passLabel = snapshot.stepName === "Sorted!" ? "Final" : `Pass ${snapshot.pass + 1}/${NUM_PASSES} (bits ${snapshot.bitOffset}-${(snapshot.bitOffset ?? 0) + 1})`
  const stepProgress = `${currentStep + 1} / ${snapshots.length}`
  const explanation = snapshot.stepName === "Sorted!" ? "Final sorted output after all passes." : EXPLANATIONS[snapshot.subStep] ?? ""

  return (
    <main className="mx-auto max-w-[1600px] space-y-4 p-6">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle>Stable Radix Sort Interactive Visualizer</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <InputControls
            value={inputText}
            onChange={setInputText}
            onRandomize={() => {
              const next = randomInput(12)
              setInputArr(next)
              setCurrentStep(0)
            }}
            onApply={() => {
              const parsed = parseInput(inputText)
              setInputArr(parsed.length ? parsed : randomInput(12))
              setCurrentStep(0)
            }}
          />
          <StepControls
            currentPass={Math.min(snapshot.pass, NUM_PASSES - 1)}
            numPasses={NUM_PASSES}
            stepProgress={stepProgress}
            onReset={() => setCurrentStep(0)}
            onPrev={() => setCurrentStep((s) => Math.max(0, s - 1))}
            onNext={() => setCurrentStep((s) => Math.min(snapshots.length - 1, s + 1))}
            onEnd={() => setCurrentStep(snapshots.length - 1)}
          />
          {renderStep(snapshot)}
          <ExplanationPanel stepTitle={snapshot.stepName} stepSubtitle={`${passLabel} · ${stepProgress}`} text={explanation} />
          <div className="flex items-center gap-4 text-xs text-slate-500">
            {DIGIT_COLORS.map((c, i) => (
              <div key={i} className="flex items-center gap-1">
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c }} />
                <span>digit {i}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </main>
  )
}

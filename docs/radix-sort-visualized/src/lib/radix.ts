import type { ScatterMove, Snapshot, StepName } from "@/types/radix"
import { BITS_PER_PASS, NUM_PASSES, RADIX } from "@/types/radix"

const STEP_NAMES: StepName[] = [
  "Extract digits",
  "Histogram",
  "Prefix sum",
  "Stable scatter",
  "Pass result",
]

export function getDigit(value: number, bitOffset: number): number {
  return (value >> bitOffset) & ((1 << BITS_PER_PASS) - 1)
}

export function randomInput(count = 12): number[] {
  return Array.from({ length: count }, () => Math.floor(Math.random() * 256))
}

export function parseInput(raw: string): number[] {
  return raw
    .split(/[\s,]+/)
    .map((s) => Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n >= 0 && n <= 255)
}

export function precomputeSnapshots(input: number[]): Snapshot[] {
  const snapshots: Snapshot[] = []
  let keys = input.slice()
  let values = keys.map((_, i) => i)

  for (let pass = 0; pass < NUM_PASSES; pass++) {
    const bitOffset = pass * BITS_PER_PASS
    const digits = keys.map((k) => getDigit(k, bitOffset))

    snapshots.push({
      pass,
      subStep: 0,
      stepName: STEP_NAMES[0],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits,
      histogram: null,
      prefixSum: null,
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
    })

    const histogram = new Array<number>(RADIX).fill(0)
    for (const d of digits) histogram[d]++

    snapshots.push({
      pass,
      subStep: 1,
      stepName: STEP_NAMES[1],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: null,
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
    })

    const prefixSum = new Array<number>(RADIX).fill(0)
    for (let d = 1; d < RADIX; d++) prefixSum[d] = prefixSum[d - 1] + histogram[d - 1]

    snapshots.push({
      pass,
      subStep: 2,
      stepName: STEP_NAMES[2],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
    })

    const offsets = prefixSum.slice()
    const scatterMap: ScatterMove[] = []
    const outputKeys = new Array<number>(keys.length)
    const outputValues = new Array<number>(keys.length)
    for (let i = 0; i < keys.length; i++) {
      const digit = digits[i]
      const dest = offsets[digit]++
      outputKeys[dest] = keys[i]
      outputValues[dest] = values[i]
      scatterMap.push({ from: i, digit, dest })
    }

    snapshots.push({
      pass,
      subStep: 3,
      stepName: STEP_NAMES[3],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap,
      outputKeys: outputKeys.slice(),
      outputValues: outputValues.slice(),
    })

    snapshots.push({
      pass,
      subStep: 4,
      stepName: STEP_NAMES[4],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap,
      outputKeys: outputKeys.slice(),
      outputValues: outputValues.slice(),
    })

    keys = outputKeys
    values = outputValues
  }

  snapshots.push({
    pass: NUM_PASSES,
    subStep: 0,
    stepName: "Sorted!",
    bitOffset: null,
    inputKeys: keys.slice(),
    inputValues: values.slice(),
    digits: null,
    histogram: null,
    prefixSum: null,
    scatterMap: null,
    outputKeys: keys.slice(),
    outputValues: values.slice(),
  })

  return snapshots
}

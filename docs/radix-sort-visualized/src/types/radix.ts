export const BITS_PER_PASS = 2
export const RADIX = 1 << BITS_PER_PASS
export const NUM_PASSES = 4

export type StepName =
  | "Extract digits"
  | "Histogram"
  | "Prefix sum"
  | "Stable scatter"
  | "Pass result"
  | "Sorted!"

export interface ScatterMove {
  from: number
  digit: number
  dest: number
}

export interface Snapshot {
  pass: number
  subStep: number
  stepName: StepName
  bitOffset: number | null
  inputKeys: number[]
  inputValues: number[]
  digits: number[] | null
  histogram: number[] | null
  prefixSum: number[] | null
  scatterMap: ScatterMove[] | null
  outputKeys: number[] | null
  outputValues: number[] | null
}

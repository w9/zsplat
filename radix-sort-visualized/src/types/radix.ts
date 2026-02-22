export const BITS_PER_PASS = 2
export const RADIX = 1 << BITS_PER_PASS
export const NUM_PASSES = 4
export const VIZ_WG_SIZE = 4
export const VIZ_ELEMENTS_PER_THREAD = 2
export const VIZ_TILE_SIZE = VIZ_WG_SIZE * VIZ_ELEMENTS_PER_THREAD

export type StepName =
  | "Extract digits"
  | "Assign workgroups"
  | "Local histogram"
  | "Local -> global"
  | "Prefix sum"
  | "Stable scatter 4a: load cumOffset + wave 0 ready"
  | "Stable scatter 4b: wave 0 rank + write"
  | "Stable scatter 4c: wave 1 ready"
  | "Stable scatter 4d: wave 1 rank + write"
  | "Stable scatter 4e: full scatter"
  | "Pass result"
  | "Sorted!"

export interface ScatterMove {
  from: number
  digit: number
  dest: number
  wg?: number
  wave?: number
  lid?: number
  base?: number
  countBelow?: number
}

export interface WorkgroupTile {
  wg: number
  start: number
  end: number
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
  numWGs?: number
  workgroupTiles?: WorkgroupTile[]
  localHistograms?: number[][] | null
  histBufBefore?: number[] | null
  histBufAfter?: number[] | null
  cumOffsetInit?: number[][] | null
  waveDigits?: number[][][] | null
  waveRanks?: number[][][] | null
  waveCounts?: number[][][] | null
  cumOffsetAfterWave?: number[][][] | null
  waveScatterMap?: ScatterMove[][] | null
  partialOutputKeys?: Array<number | null> | null
  partialOutputValues?: Array<number | null> | null
}

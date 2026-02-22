import type { ScatterMove, Snapshot, StepName, WorkgroupTile } from "@/types/radix"
import { BITS_PER_PASS, NUM_PASSES, RADIX, VIZ_ELEMENTS_PER_THREAD, VIZ_TILE_SIZE, VIZ_WG_SIZE } from "@/types/radix"

const STEP_NAMES: StepName[] = [
  "Extract digits",
  "Assign workgroups",
  "Local histogram",
  "Local -> global",
  "Prefix sum",
  "Stable scatter 4a: load cumOffset + wave 0 ready",
  "Stable scatter 4b: wave 0 rank + write",
  "Stable scatter 4c: wave 1 ready",
  "Stable scatter 4d: wave 1 rank + write",
  "Stable scatter 4e: full scatter",
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

function buildWorkgroupTiles(length: number): WorkgroupTile[] {
  const numWGs = Math.max(1, Math.ceil(length / VIZ_TILE_SIZE))
  return Array.from({ length: numWGs }, (_, wg) => {
    const start = wg * VIZ_TILE_SIZE
    return { wg, start, end: Math.min(start + VIZ_TILE_SIZE, length) }
  })
}

function clone2d(values: number[][]): number[][] {
  return values.map((row) => row.slice())
}

export function precomputeSnapshots(input: number[]): Snapshot[] {
  const snapshots: Snapshot[] = []
  let keys = input.slice()
  let values = keys.map((_, i) => i)

  for (let pass = 0; pass < NUM_PASSES; pass++) {
    const bitOffset = pass * BITS_PER_PASS
    const digits = keys.map((k) => getDigit(k, bitOffset))
    const workgroupTiles = buildWorkgroupTiles(keys.length)
    const numWGs = workgroupTiles.length

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
      numWGs,
      workgroupTiles,
    })

    const localHistograms = Array.from({ length: numWGs }, () => new Array<number>(RADIX).fill(0))
    for (const tile of workgroupTiles) {
      for (let i = tile.start; i < tile.end; i++) {
        localHistograms[tile.wg][digits[i]]++
      }
    }

    snapshots.push({
      pass,
      subStep: 1,
      stepName: STEP_NAMES[1],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: null,
      prefixSum: null,
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
    })

    snapshots.push({
      pass,
      subStep: 2,
      stepName: STEP_NAMES[2],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: localHistograms.reduce((sum, local) => sum.map((v, d) => v + local[d]), new Array<number>(RADIX).fill(0)),
      prefixSum: null,
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
    })

    const histBufBefore = new Array<number>(RADIX * numWGs).fill(0)
    for (let d = 0; d < RADIX; d++) {
      for (let wg = 0; wg < numWGs; wg++) {
        histBufBefore[d * numWGs + wg] = localHistograms[wg][d]
      }
    }

    snapshots.push({
      pass,
      subStep: 3,
      stepName: STEP_NAMES[3],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: localHistograms.reduce((sum, local) => sum.map((v, d) => v + local[d]), new Array<number>(RADIX).fill(0)),
      prefixSum: null,
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
    })

    const histBufAfter = histBufBefore.slice()
    let running = 0
    for (let i = 0; i < histBufAfter.length; i++) {
      const c = histBufAfter[i]
      histBufAfter[i] = running
      running += c
    }

    const histogram = new Array<number>(RADIX).fill(0)
    for (let d = 0; d < RADIX; d++) {
      for (let wg = 0; wg < numWGs; wg++) histogram[d] += localHistograms[wg][d]
    }
    const prefixSum = new Array<number>(RADIX).fill(0)
    for (let d = 1; d < RADIX; d++) prefixSum[d] = prefixSum[d - 1] + histogram[d - 1]

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
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
      histBufAfter: histBufAfter.slice(),
    })

    const cumOffsetInit = Array.from({ length: numWGs }, (_, wg) =>
      Array.from({ length: RADIX }, (_, d) => histBufAfter[d * numWGs + wg]),
    )
    const cumOffset = clone2d(cumOffsetInit)
    const waveDigits = Array.from({ length: numWGs }, () =>
      Array.from({ length: VIZ_ELEMENTS_PER_THREAD }, () => new Array<number>(VIZ_WG_SIZE).fill(-1)),
    )
    const waveRanks = Array.from({ length: numWGs }, () =>
      Array.from({ length: VIZ_ELEMENTS_PER_THREAD }, () => new Array<number>(VIZ_WG_SIZE).fill(-1)),
    )
    const waveCounts = Array.from({ length: numWGs }, () =>
      Array.from({ length: VIZ_ELEMENTS_PER_THREAD }, () => new Array<number>(RADIX).fill(0)),
    )
    const cumOffsetAfterWave: number[][][] = []
    const waveScatterMap = Array.from({ length: VIZ_ELEMENTS_PER_THREAD }, () => [] as ScatterMove[])
    const scatterMap: ScatterMove[] = []
    const outputKeys = new Array<number | null>(keys.length).fill(null)
    const outputValues = new Array<number | null>(keys.length).fill(null)

    // Preload per-wave digits so they are visible at subStep 5.
    for (let wave = 0; wave < VIZ_ELEMENTS_PER_THREAD; wave++) {
      for (let wg = 0; wg < numWGs; wg++) {
        const tileStart = wg * VIZ_TILE_SIZE
        for (let lid = 0; lid < VIZ_WG_SIZE; lid++) {
          const idx = tileStart + wave * VIZ_WG_SIZE + lid
          if (idx < keys.length) waveDigits[wg][wave][lid] = digits[idx]
        }
      }
    }

    snapshots.push({
      pass,
      subStep: 5,
      stepName: STEP_NAMES[5],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap: null,
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
      histBufAfter: histBufAfter.slice(),
      cumOffsetInit: clone2d(cumOffsetInit),
      waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
    })

    for (let wave = 0; wave < VIZ_ELEMENTS_PER_THREAD; wave++) {
      for (let wg = 0; wg < numWGs; wg++) {
        const tileStart = wg * VIZ_TILE_SIZE
        const waveCount = new Array<number>(RADIX).fill(0)
        for (let lid = 0; lid < VIZ_WG_SIZE; lid++) {
          const idx = tileStart + wave * VIZ_WG_SIZE + lid
          if (idx >= keys.length) continue
          const digit = waveDigits[wg][wave][lid]
          let countBelow = 0
          for (let prev = 0; prev < lid; prev++) {
            if (waveDigits[wg][wave][prev] === digit) countBelow++
          }
          const base = cumOffset[wg][digit]
          const dest = base + countBelow
          waveRanks[wg][wave][lid] = countBelow
          waveCount[digit]++
          outputKeys[dest] = keys[idx]
          outputValues[dest] = values[idx]
          const move: ScatterMove = { from: idx, digit, dest, wg, wave, lid, base, countBelow }
          waveScatterMap[wave].push(move)
          scatterMap.push(move)
        }
        waveCounts[wg][wave] = waveCount
      }

      for (let wg = 0; wg < numWGs; wg++) {
        for (let d = 0; d < RADIX; d++) {
          cumOffset[wg][d] += waveCounts[wg][wave][d]
        }
      }
      cumOffsetAfterWave.push(clone2d(cumOffset))

      if (wave === 0) {
        snapshots.push({
          pass,
          subStep: 6,
          stepName: STEP_NAMES[6],
          bitOffset,
          inputKeys: keys.slice(),
          inputValues: values.slice(),
          digits: digits.slice(),
          histogram: histogram.slice(),
          prefixSum: prefixSum.slice(),
          scatterMap: waveScatterMap[0].slice(),
          outputKeys: null,
          outputValues: null,
          numWGs,
          workgroupTiles,
          localHistograms: clone2d(localHistograms),
          histBufBefore: histBufBefore.slice(),
          histBufAfter: histBufAfter.slice(),
          cumOffsetInit: clone2d(cumOffsetInit),
          waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
          waveRanks: waveRanks.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
          waveCounts: waveCounts.map((wgWaves) => wgWaves.map((counts) => counts.slice())),
          cumOffsetAfterWave: cumOffsetAfterWave.map((state) => clone2d(state)),
          waveScatterMap: waveScatterMap.map((moves) => moves.slice()),
          partialOutputKeys: outputKeys.slice(),
          partialOutputValues: outputValues.slice(),
        })

        snapshots.push({
          pass,
          subStep: 7,
          stepName: STEP_NAMES[7],
          bitOffset,
          inputKeys: keys.slice(),
          inputValues: values.slice(),
          digits: digits.slice(),
          histogram: histogram.slice(),
          prefixSum: prefixSum.slice(),
          scatterMap: null,
          outputKeys: null,
          outputValues: null,
          numWGs,
          workgroupTiles,
          localHistograms: clone2d(localHistograms),
          histBufBefore: histBufBefore.slice(),
          histBufAfter: histBufAfter.slice(),
          cumOffsetInit: clone2d(cumOffsetInit),
          waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
          waveRanks: waveRanks.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
          waveCounts: waveCounts.map((wgWaves) => wgWaves.map((counts) => counts.slice())),
          cumOffsetAfterWave: cumOffsetAfterWave.map((state) => clone2d(state)),
          waveScatterMap: waveScatterMap.map((moves) => moves.slice()),
          partialOutputKeys: outputKeys.slice(),
          partialOutputValues: outputValues.slice(),
        })
      }
    }

    snapshots.push({
      pass,
      subStep: 8,
      stepName: STEP_NAMES[8],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap: waveScatterMap[1].slice(),
      outputKeys: null,
      outputValues: null,
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
      histBufAfter: histBufAfter.slice(),
      cumOffsetInit: clone2d(cumOffsetInit),
      waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveRanks: waveRanks.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveCounts: waveCounts.map((wgWaves) => wgWaves.map((counts) => counts.slice())),
      cumOffsetAfterWave: cumOffsetAfterWave.map((state) => clone2d(state)),
      waveScatterMap: waveScatterMap.map((moves) => moves.slice()),
      partialOutputKeys: outputKeys.slice(),
      partialOutputValues: outputValues.slice(),
    })

    const outputKeysFinal = outputKeys.map((v) => v ?? 0)
    const outputValuesFinal = outputValues.map((v) => v ?? 0)

    snapshots.push({
      pass,
      subStep: 9,
      stepName: STEP_NAMES[9],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap: scatterMap.slice(),
      outputKeys: outputKeysFinal.slice(),
      outputValues: outputValuesFinal.slice(),
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
      histBufAfter: histBufAfter.slice(),
      cumOffsetInit: clone2d(cumOffsetInit),
      waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveRanks: waveRanks.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveCounts: waveCounts.map((wgWaves) => wgWaves.map((counts) => counts.slice())),
      cumOffsetAfterWave: cumOffsetAfterWave.map((state) => clone2d(state)),
      waveScatterMap: waveScatterMap.map((moves) => moves.slice()),
      partialOutputKeys: outputKeys.slice(),
      partialOutputValues: outputValues.slice(),
    })

    snapshots.push({
      pass,
      subStep: 10,
      stepName: STEP_NAMES[10],
      bitOffset,
      inputKeys: keys.slice(),
      inputValues: values.slice(),
      digits: digits.slice(),
      histogram: histogram.slice(),
      prefixSum: prefixSum.slice(),
      scatterMap: scatterMap.slice(),
      outputKeys: outputKeysFinal.slice(),
      outputValues: outputValuesFinal.slice(),
      numWGs,
      workgroupTiles,
      localHistograms: clone2d(localHistograms),
      histBufBefore: histBufBefore.slice(),
      histBufAfter: histBufAfter.slice(),
      cumOffsetInit: clone2d(cumOffsetInit),
      waveDigits: waveDigits.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveRanks: waveRanks.map((wgWaves) => wgWaves.map((lids) => lids.slice())),
      waveCounts: waveCounts.map((wgWaves) => wgWaves.map((counts) => counts.slice())),
      cumOffsetAfterWave: cumOffsetAfterWave.map((state) => clone2d(state)),
      waveScatterMap: waveScatterMap.map((moves) => moves.slice()),
      partialOutputKeys: outputKeys.slice(),
      partialOutputValues: outputValues.slice(),
    })

    keys = outputKeysFinal
    values = outputValuesFinal
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

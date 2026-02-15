// ============================================================
// GPU Radix Sort — 4 passes of 8 bits each on 32-bit keys
//
// Three entry points:
//   histogram  — count digit occurrences per workgroup
//   prefixSum  — exclusive prefix sum over the histogram table
//   scatter    — reorder key-value pairs
//
// The host dispatches: for each of 4 passes:
//   histogram → prefixSum → scatter
// and ping-pongs between buffer pairs.
// ============================================================

const WG_SIZE: u32 = 256u;
const RADIX: u32 = 256u;           // 2^8 = 256 bins per pass
const ELEMENTS_PER_THREAD: u32 = 16u;
const TILE_SIZE: u32 = 4096u;      // WG_SIZE * ELEMENTS_PER_THREAD

struct SortUniforms {
  numElements: u32,
  bitOffset:   u32,    // 0, 8, 16, 24 for each pass
  numWGs:      u32,
  _pad:        u32,
};

@group(0) @binding(0) var<uniform> su: SortUniforms;
@group(0) @binding(1) var<storage, read>       keysIn:   array<u32>;
@group(0) @binding(2) var<storage, read>       valsIn:   array<u32>;
@group(0) @binding(3) var<storage, read_write> keysOut:  array<u32>;
@group(0) @binding(4) var<storage, read_write> valsOut:  array<u32>;
@group(0) @binding(5) var<storage, read_write> histBuf:  array<u32>; // RADIX * numWGs

// ---- Histogram ----
var<workgroup> localHist: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn histogram(
  @builtin(global_invocation_id)  gid: vec3<u32>,
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  // Clear shared histogram
  localHist[lid.x] = 0u;
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;

  // Each thread processes ELEMENTS_PER_THREAD elements
  for (var t = 0u; t < ELEMENTS_PER_THREAD; t++) {
    let i = tileStart + lid.x * ELEMENTS_PER_THREAD + t;
    if (i < su.numElements) {
      let key = keysIn[i];
      let digit = (key >> su.bitOffset) & 0xFFu;
      atomicAdd(&localHist[digit], 1u);
    }
  }

  workgroupBarrier();

  // Write local histogram to global buffer
  // Layout: histBuf[digit * numWGs + wgid]
  histBuf[lid.x * su.numWGs + wgid.x] = atomicLoad(&localHist[lid.x]);
}

// ---- Prefix Sum ----
// Computes exclusive prefix sum over histBuf (RADIX * numWGs entries).
// We process in tiles within a single workgroup.
var<workgroup> prefixShared: array<u32, 256>;

@compute @workgroup_size(256)
fn prefixSum(
  @builtin(local_invocation_id) lid: vec3<u32>,
) {
  let totalElements = RADIX * su.numWGs;
  var runningSum = 0u;

  // Process the histogram in tiles of WG_SIZE
  let numTiles = (totalElements + WG_SIZE - 1u) / WG_SIZE;

  for (var tile = 0u; tile < numTiles; tile++) {
    let idx = tile * WG_SIZE + lid.x;

    // Load
    var val = 0u;
    if (idx < totalElements) {
      val = histBuf[idx];
    }
    prefixShared[lid.x] = val;
    workgroupBarrier();

    // Blelloch scan — up-sweep
    for (var d = 1u; d < WG_SIZE; d = d << 1u) {
      let ai = (lid.x + 1u) * (d << 1u) - 1u;
      if (ai < WG_SIZE) {
        prefixShared[ai] += prefixShared[ai - d];
      }
      workgroupBarrier();
    }

    // Store total and clear last
    var blockTotal = 0u;
    if (lid.x == 0u) {
      blockTotal = prefixShared[WG_SIZE - 1u];
      prefixShared[WG_SIZE - 1u] = 0u;
    }
    workgroupBarrier();

    // Down-sweep
    for (var d = WG_SIZE >> 1u; d >= 1u; d = d >> 1u) {
      let ai = (lid.x + 1u) * (d << 1u) - 1u;
      if (ai < WG_SIZE) {
        let t2 = prefixShared[ai - d];
        prefixShared[ai - d] = prefixShared[ai];
        prefixShared[ai] += t2;
      }
      workgroupBarrier();
    }

    // Add running sum and write back
    if (idx < totalElements) {
      histBuf[idx] = prefixShared[lid.x] + runningSum;
    }
    workgroupBarrier();

    // Broadcast blockTotal to all threads
    if (lid.x == 0u) {
      prefixShared[0] = blockTotal;
    }
    workgroupBarrier();
    runningSum += prefixShared[0];
    workgroupBarrier();
  }
}

// ---- Scatter ----
var<workgroup> localOffsets: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn scatter(
  @builtin(global_invocation_id)  gid: vec3<u32>,
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  // Load this workgroup's prefix sums for each digit
  // histBuf[digit * numWGs + wgid] = exclusive prefix sum = scatter base
  localOffsets[lid.x] = histBuf[lid.x * su.numWGs + wgid.x];
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;

  for (var t = 0u; t < ELEMENTS_PER_THREAD; t++) {
    let i = tileStart + lid.x * ELEMENTS_PER_THREAD + t;
    if (i < su.numElements) {
      let key = keysIn[i];
      let val = valsIn[i];
      let digit = (key >> su.bitOffset) & 0xFFu;
      let dest = atomicAdd(&localOffsets[digit], 1u);
      keysOut[dest] = key;
      valsOut[dest] = val;
    }
  }
}

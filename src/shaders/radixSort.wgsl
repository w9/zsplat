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
  numElements:  u32,
  bitOffset:    u32,    // 0, 8, 16, 24 for each pass
  numWGs:       u32,
  isFirstPass:  u32,    // 1 on pass 0 (skip valsIn read), 0 otherwise
};

@group(0) @binding(0) var<uniform> su: SortUniforms;
@group(0) @binding(1) var<storage, read>       keysIn:   array<u32>;
@group(0) @binding(2) var<storage, read>       valsIn:   array<u32>;
@group(0) @binding(3) var<storage, read_write> keysOut:  array<u32>;
@group(0) @binding(4) var<storage, read_write> valsOut:  array<u32>;
@group(0) @binding(5) var<storage, read_write> histBuf:  array<u32>; // RADIX * numWGs
@group(0) @binding(6) var<storage, read_write> localPrefixBuf: array<u32>;

// ---- Histogram ----
var<workgroup> localHist: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn histogram(
  @builtin(global_invocation_id)  gid: vec3<u32>,
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  // Clear shared histogram (not needed but doesn't hurt performance)
  atomicStore(&localHist[lid.x], 0u);
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

// ---- Scatter (unstable — atomicAdd ordering is non-deterministic) ----
var<workgroup> localOffsets: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn scatter(
  @builtin(global_invocation_id)  gid: vec3<u32>,
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  atomicStore(&localOffsets[lid.x], histBuf[lid.x * su.numWGs + wgid.x]);
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;

  for (var t = 0u; t < ELEMENTS_PER_THREAD; t++) {
    let i = tileStart + lid.x * ELEMENTS_PER_THREAD + t;
    if (i < su.numElements) {
      let key = keysIn[i];
      let val = select(valsIn[i], i, su.isFirstPass != 0u);
      let digit = (key >> su.bitOffset) & 0xFFu;
      let dest = atomicAdd(&localOffsets[digit], 1u);
      keysOut[dest] = key;
      valsOut[dest] = val;
    }
  }
}

// ---- Stable Scatter (deterministic wave-based ordering) ----
// Processes elements in waves of WG_SIZE. Within each wave, every
// thread handles exactly one element. The rank of each element
// within its digit bucket is computed by counting how many threads
// with a lower lid.x share the same digit — this is deterministic
// and preserves the input order, making the radix sort stable.

var<workgroup> sharedDigits: array<u32, 256>;
var<workgroup> cumOffset: array<u32, 256>;

@compute @workgroup_size(256)
fn stableScatter(
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  // Load this workgroup's global prefix-sum offsets per digit
  cumOffset[lid.x] = histBuf[lid.x * su.numWGs + wgid.x];
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;

  // Process elements in waves (coalesced, deterministic order)
  for (var wave = 0u; wave < ELEMENTS_PER_THREAD; wave++) {
    let i = tileStart + wave * WG_SIZE + lid.x;

    // Load element (or sentinel)
    var myDigit = RADIX; // sentinel: "no element"
    var myKey = 0u;
    var myVal = 0u;
    if (i < su.numElements) {
      myKey = keysIn[i];
      myVal = select(valsIn[i], i, su.isFirstPass != 0u);
      myDigit = (myKey >> su.bitOffset) & 0xFFu;
    }

    // Publish digit so all threads can see each other's digits
    sharedDigits[lid.x] = myDigit;
    workgroupBarrier();

    // Compute rank: count threads with lower lid.x that share my digit
    // Vectorized: process 4 sharedDigits entries per iteration
    if (myDigit < RADIX) {
      var rank = cumOffset[myDigit];
      let limit = lid.x & ~3u;
      var j = 0u;
      for (; j < limit; j += 4u) {
        let d = vec4<u32>(sharedDigits[j], sharedDigits[j+1u], sharedDigits[j+2u], sharedDigits[j+3u]);
        rank += select(0u, 1u, d.x == myDigit) + select(0u, 1u, d.y == myDigit)
              + select(0u, 1u, d.z == myDigit) + select(0u, 1u, d.w == myDigit);
      }
      for (; j < lid.x; j++) { rank += select(0u, 1u, sharedDigits[j] == myDigit); }
      keysOut[rank] = myKey;
      valsOut[rank] = myVal;
    }

    workgroupBarrier();

    // Update cumulative offsets: each thread counts one digit
    // Vectorized: process 4 entries per iteration
    if (lid.x < RADIX) {
      var count = 0u;
      let myBucket = lid.x;
      var j2 = 0u;
      for (; j2 + 3u < WG_SIZE; j2 += 4u) {
        let d = vec4<u32>(sharedDigits[j2], sharedDigits[j2+1u], sharedDigits[j2+2u], sharedDigits[j2+3u]);
        count += select(0u, 1u, d.x == myBucket) + select(0u, 1u, d.y == myBucket)
               + select(0u, 1u, d.z == myBucket) + select(0u, 1u, d.w == myBucket);
      }
      for (; j2 < WG_SIZE; j2++) { count += select(0u, 1u, sharedDigits[j2] == myBucket); }
      cumOffset[lid.x] += count;
    }

    workgroupBarrier();
  }
}

// ---- Stable Block Sum ----
// Phase 1 of the separated scatter: computes per-element local prefix
// (rank within workgroup) and per-WG histogram. Writes results to
// localPrefixBuf and histBuf. No scatter writes.

@compute @workgroup_size(256)
fn stableBlockSum(
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
) {
  atomicStore(&localHist[lid.x], 0u);
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;

  for (var wave = 0u; wave < ELEMENTS_PER_THREAD; wave++) {
    let i = tileStart + wave * WG_SIZE + lid.x;

    var myDigit = RADIX;
    if (i < su.numElements) {
      let key = keysIn[i];
      myDigit = (key >> su.bitOffset) & 0xFFu;
    }

    sharedDigits[lid.x] = myDigit;
    workgroupBarrier();

    // Vectorized rank: count same-digit threads with lower lid
    if (myDigit < RADIX) {
      var localRank = 0u;
      let limit = lid.x & ~3u;
      var j = 0u;
      for (; j < limit; j += 4u) {
        let d = vec4<u32>(sharedDigits[j], sharedDigits[j+1u], sharedDigits[j+2u], sharedDigits[j+3u]);
        localRank += select(0u, 1u, d.x == myDigit) + select(0u, 1u, d.y == myDigit)
                   + select(0u, 1u, d.z == myDigit) + select(0u, 1u, d.w == myDigit);
      }
      for (; j < lid.x; j++) { localRank += select(0u, 1u, sharedDigits[j] == myDigit); }

      // Add cumulative offset from previous waves within this WG
      localRank += atomicLoad(&localHist[myDigit]);
      localPrefixBuf[i] = localRank;
    }

    workgroupBarrier();

    // Update per-digit counts for this wave (vectorized)
    if (lid.x < RADIX) {
      var count = 0u;
      let myBucket = lid.x;
      var j2 = 0u;
      for (; j2 + 3u < WG_SIZE; j2 += 4u) {
        let d = vec4<u32>(sharedDigits[j2], sharedDigits[j2+1u], sharedDigits[j2+2u], sharedDigits[j2+3u]);
        count += select(0u, 1u, d.x == myBucket) + select(0u, 1u, d.y == myBucket)
               + select(0u, 1u, d.z == myBucket) + select(0u, 1u, d.w == myBucket);
      }
      for (; j2 < WG_SIZE; j2++) { count += select(0u, 1u, sharedDigits[j2] == myBucket); }
      atomicAdd(&localHist[lid.x], count);
    }

    workgroupBarrier();
  }

  // Write final per-WG histogram to global histBuf
  histBuf[lid.x * su.numWGs + wgid.x] = atomicLoad(&localHist[lid.x]);
}

// ---- Stable Reorder ----
// Phase 3 of the separated scatter: trivial kernel that reads
// pre-computed local prefix and global prefix-sum offsets to
// compute final output position. No shared memory rank loops.

@compute @workgroup_size(256)
fn stableReorder(
  @builtin(global_invocation_id)  gid: vec3<u32>,
) {
  let i = gid.x;
  if (i >= su.numElements) { return; }

  let key = keysIn[i];
  let val = select(valsIn[i], i, su.isFirstPass != 0u);
  let digit = (key >> su.bitOffset) & 0xFFu;
  let localPrefix = localPrefixBuf[i];
  // histBuf stores per-source-workgroup offsets; reorder dispatch workgroups
  // are independent, so derive source WG from element index.
  let sourceWG = i / TILE_SIZE;
  let globalOffset = histBuf[digit * su.numWGs + sourceWG];
  let dest = globalOffset + localPrefix;

  keysOut[dest] = key;
  valsOut[dest] = val;
}

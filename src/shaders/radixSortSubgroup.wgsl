// ============================================================
// Stable Scatter — subgroup-aware variant
//
// Requires the 'subgroups' WebGPU feature.
// Uses subgroup-sized chunks inside each wave to reduce the
// per-lane rank loop length while preserving deterministic ordering.
// ============================================================

enable subgroups;

const WG_SIZE: u32 = 256u;
const RADIX: u32 = 256u;
const ELEMENTS_PER_THREAD: u32 = 16u;
const TILE_SIZE: u32 = 4096u;

struct SortUniforms {
  numElements: u32,
  bitOffset:   u32,
  numWGs:      u32,
  _pad:        u32,
};

@group(0) @binding(0) var<uniform> su: SortUniforms;
@group(0) @binding(1) var<storage, read>       keysIn:   array<u32>;
@group(0) @binding(2) var<storage, read>       valsIn:   array<u32>;
@group(0) @binding(3) var<storage, read_write> keysOut:  array<u32>;
@group(0) @binding(4) var<storage, read_write> valsOut:  array<u32>;
@group(0) @binding(5) var<storage, read_write> histBuf:  array<u32>;

var<workgroup> sharedDigits: array<u32, 256>;
var<workgroup> cumOffset: array<u32, 256>;
var<workgroup> subgroupDigitCounts: array<atomic<u32>, 256>;

@compute @workgroup_size(256)
fn stableScatterSubgroup(
  @builtin(workgroup_id)          wgid: vec3<u32>,
  @builtin(local_invocation_id)   lid: vec3<u32>,
  @builtin(subgroup_size)         subgroupSize: u32,
) {
  cumOffset[lid.x] = histBuf[lid.x * su.numWGs + wgid.x];
  atomicStore(&subgroupDigitCounts[lid.x], 0u);
  workgroupBarrier();

  let tileStart = wgid.x * TILE_SIZE;
  let safeSubgroupSize = max(1u, subgroupSize);
  let numSubgroups = (WG_SIZE + safeSubgroupSize - 1u) / safeSubgroupSize;

  for (var wave = 0u; wave < ELEMENTS_PER_THREAD; wave++) {
    let i = tileStart + wave * WG_SIZE + lid.x;

    var myDigit = RADIX;
    var myKey = 0u;
    var myVal = 0u;
    if (i < su.numElements) {
      myKey = keysIn[i];
      myVal = valsIn[i];
      myDigit = (myKey >> su.bitOffset) & 0xFFu;
    }

    sharedDigits[lid.x] = myDigit;
    workgroupBarrier();

    for (var sg = 0u; sg < numSubgroups; sg++) {
      let sgStart = sg * safeSubgroupSize;
      let sgEnd = min(sgStart + safeSubgroupSize, WG_SIZE);
      let inSubgroup = lid.x >= sgStart && lid.x < sgEnd;

      if (inSubgroup && myDigit < RADIX) {
        var rank = cumOffset[myDigit];
        for (var j = sgStart; j < lid.x; j++) {
          if (sharedDigits[j] == myDigit) {
            rank++;
          }
        }
        keysOut[rank] = myKey;
        valsOut[rank] = myVal;
        atomicAdd(&subgroupDigitCounts[myDigit], 1u);
      }

      workgroupBarrier();

      if (lid.x < RADIX) {
        let count = atomicLoad(&subgroupDigitCounts[lid.x]);
        cumOffset[lid.x] += count;
        atomicStore(&subgroupDigitCounts[lid.x], 0u);
      }

      workgroupBarrier();
    }
  }
}

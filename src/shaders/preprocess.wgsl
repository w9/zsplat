// ============================================================
// Preprocess compute shader
// Per-splat: project 3D Gaussian to 2D screen space,
// compute 2D covariance and its inverse (conic),
// emit depth keys for sorting.
// ============================================================

struct Uniforms {
  view:       mat4x4<f32>,
  proj:       mat4x4<f32>,
  viewport:   vec2<f32>,      // width, height in pixels
  numSplats:  u32,
  _pad:       u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

// Input splat data (SoA layout, one entry per splat)
@group(0) @binding(1) var<storage, read> positions:  array<f32>;  // N*3
@group(0) @binding(2) var<storage, read> rotations:  array<f32>;  // N*4 (w,x,y,z)
@group(0) @binding(3) var<storage, read> scales_in:  array<f32>;  // N*3 (already exp'd)
@group(0) @binding(4) var<storage, read> colors_in:  array<f32>;  // N*4 (rgba)

// Output: preprocessed splat data for rendering (12 floats per splat)
//   [0]:  center_ndc.x
//   [1]:  center_ndc.y
//   [2]:  extent_ndc.x  (half-width of bounding quad in NDC)
//   [3]:  extent_ndc.y  (half-height)
//   [4]:  conic_ndc.x   (inverse cov [0][0] in NDC space)
//   [5]:  conic_ndc.y   (inverse cov [0][1] in NDC space)
//   [6]:  conic_ndc.z   (inverse cov [1][1] in NDC space)
//   [7]:  color.r
//   [8]:  color.g
//   [9]:  color.b
//   [10]: opacity
//   [11]: depth
@group(0) @binding(5) var<storage, read_write> splatOut: array<f32>;

// Sort keys and values
@group(0) @binding(6) var<storage, read_write> sortKeys:   array<u32>;
@group(0) @binding(7) var<storage, read_write> sortValues: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= u.numSplats) {
    return;
  }

  // ---- Read splat data ----
  let pos = vec3<f32>(
    positions[idx * 3u],
    positions[idx * 3u + 1u],
    positions[idx * 3u + 2u],
  );

  let qw = rotations[idx * 4u];
  let qx = rotations[idx * 4u + 1u];
  let qy = rotations[idx * 4u + 2u];
  let qz = rotations[idx * 4u + 3u];

  let sx = scales_in[idx * 3u];
  let sy = scales_in[idx * 3u + 1u];
  let sz = scales_in[idx * 3u + 2u];

  let col = vec4<f32>(
    colors_in[idx * 4u],
    colors_in[idx * 4u + 1u],
    colors_in[idx * 4u + 2u],
    colors_in[idx * 4u + 3u],
  );

  // ---- Transform to camera space ----
  let cam = u.view * vec4<f32>(pos, 1.0);
  let camPos = cam.xyz;

  // Behind-camera cull
  if (camPos.z > -0.1) {
    writeInvisible(idx);
    return;
  }

  // ---- Compute 3D covariance ----
  let xx = qx * qx; let yy = qy * qy; let zz = qz * qz;
  let xy = qx * qy; let xz = qx * qz; let yz = qy * qz;
  let wx = qw * qx; let wy = qw * qy; let wz = qw * qz;

  // Rotation matrix columns
  let rc0 = vec3<f32>(1.0 - 2.0*(yy+zz), 2.0*(xy+wz), 2.0*(xz-wy));
  let rc1 = vec3<f32>(2.0*(xy-wz), 1.0 - 2.0*(xx+zz), 2.0*(yz+wx));
  let rc2 = vec3<f32>(2.0*(xz+wy), 2.0*(yz-wx), 1.0 - 2.0*(xx+yy));

  // M = R * S
  let m0 = rc0 * sx;
  let m1 = rc1 * sy;
  let m2 = rc2 * sz;

  // 3D covariance Sigma = M * M^T (symmetric)
  let s00 = dot(m0, m0);
  let s01 = dot(m0, m1);
  let s02 = dot(m0, m2);
  let s11 = dot(m1, m1);
  let s12 = dot(m1, m2);
  let s22 = dot(m2, m2);

  // ---- Project to 2D covariance ----
  // View matrix rows (world→camera rotation)
  let W0 = vec3<f32>(u.view[0][0], u.view[1][0], u.view[2][0]);
  let W1 = vec3<f32>(u.view[0][1], u.view[1][1], u.view[2][1]);
  let W2 = vec3<f32>(u.view[0][2], u.view[1][2], u.view[2][2]);

  // Focal lengths (use abs because proj[1][1] may be negative from y-flip)
  let fx = abs(u.proj[0][0]) * u.viewport.x * 0.5;
  let fy = abs(u.proj[1][1]) * u.viewport.y * 0.5;

  let tz = camPos.z;
  let tz2 = tz * tz;

  // Jacobian of projection (camera → pixel): J = [[fx/z, 0, -fx*x/z²], [0, fy/z, -fy*y/z²]]
  // Note: z is negative, so fx/z is negative; but T*Σ*T^T squares it out
  let j00 = fx / tz;
  let j02 = -fx * camPos.x / tz2;
  let j11 = fy / tz;
  let j12 = -fy * camPos.y / tz2;

  // T = J * W (2x3 matrix, rows are T0 and T1)
  let T0 = j00 * W0 + j02 * W2;
  let T1 = j11 * W1 + j12 * W2;

  // 2D covariance in pixel space: cov = T * Sigma * T^T
  // V = Sigma * T^T (3x2)
  let v00 = s00*T0.x + s01*T0.y + s02*T0.z;
  let v01 = s00*T1.x + s01*T1.y + s02*T1.z;
  let v10 = s01*T0.x + s11*T0.y + s12*T0.z;
  let v11 = s01*T1.x + s11*T1.y + s12*T1.z;
  let v20 = s02*T0.x + s12*T0.y + s22*T0.z;
  let v21 = s02*T1.x + s12*T1.y + s22*T1.z;

  // cov = T * V (2x2 symmetric)
  var cov_a = T0.x*v00 + T0.y*v10 + T0.z*v20;
  var cov_b = T0.x*v01 + T0.y*v11 + T0.z*v21;
  var cov_d = T1.x*v01 + T1.y*v11 + T1.z*v21;

  // Regularization
  cov_a += 0.3;
  cov_d += 0.3;

  // ---- Compute conic (inverse of 2D cov) ----
  let det = cov_a * cov_d - cov_b * cov_b;
  if (det <= 0.0) {
    writeInvisible(idx);
    return;
  }
  let inv_det = 1.0 / det;
  let conic_a = cov_d * inv_det;   // inv[0][0]
  let conic_b = -cov_b * inv_det;  // inv[0][1]
  let conic_d = cov_a * inv_det;   // inv[1][1]

  // ---- Bounding box (3σ) in pixels, then NDC ----
  let radius_x = ceil(3.0 * sqrt(cov_a));
  let radius_y = ceil(3.0 * sqrt(cov_d));

  if (radius_x < 1.0 && radius_y < 1.0) {
    writeInvisible(idx);
    return;
  }

  // Convert pixel conic to NDC conic: conic_ndc = S * conic_pixel * S
  // where S = diag(vp.x/2, vp.y/2)
  let half_vp = u.viewport * 0.5;
  let cn_a = conic_a * half_vp.x * half_vp.x;
  let cn_b = conic_b * half_vp.x * half_vp.y;
  let cn_d = conic_d * half_vp.y * half_vp.y;

  // NDC extents
  let ext_x = radius_x * 2.0 / u.viewport.x;
  let ext_y = radius_y * 2.0 / u.viewport.y;

  // ---- NDC center ----
  let clip = u.proj * cam;
  let ndc = clip.xy / clip.w;

  // ---- Write output ----
  let base = idx * 12u;
  splatOut[base + 0u]  = ndc.x;
  splatOut[base + 1u]  = ndc.y;
  splatOut[base + 2u]  = ext_x;
  splatOut[base + 3u]  = ext_y;
  splatOut[base + 4u]  = cn_a;
  splatOut[base + 5u]  = cn_b;
  splatOut[base + 6u]  = cn_d;
  splatOut[base + 7u]  = col.r;
  splatOut[base + 8u]  = col.g;
  splatOut[base + 9u]  = col.b;
  splatOut[base + 10u] = col.a;
  splatOut[base + 11u] = -camPos.z;

  // ---- Sort key ----
  let depthBits = bitcast<u32>(-camPos.z);
  let sortKey = 0xFFFFFFFFu - floatToSortableUint(depthBits);
  sortKeys[idx] = sortKey;
  sortValues[idx] = idx;
}

fn writeInvisible(idx: u32) {
  let base = idx * 12u;
  for (var j = 0u; j < 12u; j++) {
    splatOut[base + j] = 0.0;
  }
  sortKeys[idx] = 0xFFFFFFFFu;
  sortValues[idx] = idx;
}

fn floatToSortableUint(bits: u32) -> u32 {
  let mask = select(0x80000000u, 0xFFFFFFFFu, (bits & 0x80000000u) != 0u);
  return bits ^ mask;
}

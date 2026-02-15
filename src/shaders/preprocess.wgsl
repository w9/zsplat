// ============================================================
// Preprocess compute shader
// Per-splat: project 3D Gaussian to 2D, compute conic in NDC
// space directly (no pixel↔NDC conversion needed), emit sort keys.
// ============================================================

struct Uniforms {
  view:       mat4x4<f32>,
  proj:       mat4x4<f32>,
  viewport:   vec2<f32>,
  numSplats:  u32,
  _pad:       u32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> positions:  array<f32>;
@group(0) @binding(2) var<storage, read> rotations:  array<f32>;
@group(0) @binding(3) var<storage, read> scales_in:  array<f32>;
@group(0) @binding(4) var<storage, read> colors_in:  array<f32>;

// Output: 12 floats per splat
//   [0-1]:  center_ndc.xy
//   [2-3]:  extent_ndc.xy  (bounding quad half-size)
//   [4-6]:  conic_ndc (a, b, d) — inverse 2D cov in NDC
//   [7-9]:  color.rgb
//   [10]:   opacity
//   [11]:   depth
@group(0) @binding(5) var<storage, read_write> splatOut: array<f32>;
@group(0) @binding(6) var<storage, read_write> sortKeys:   array<u32>;
@group(0) @binding(7) var<storage, read_write> sortValues: array<u32>;

@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= u.numSplats) { return; }

  // ---- Read splat ----
  let pos = vec3<f32>(positions[idx*3u], positions[idx*3u+1u], positions[idx*3u+2u]);
  let qw = rotations[idx*4u];
  let qx = rotations[idx*4u+1u];
  let qy = rotations[idx*4u+2u];
  let qz = rotations[idx*4u+3u];
  let sx = scales_in[idx*3u];
  let sy = scales_in[idx*3u+1u];
  let sz = scales_in[idx*3u+2u];
  let col = vec4<f32>(colors_in[idx*4u], colors_in[idx*4u+1u], colors_in[idx*4u+2u], colors_in[idx*4u+3u]);

  // ---- Camera transform ----
  let cam = u.view * vec4<f32>(pos, 1.0);
  if (cam.z > -0.1) { writeInvisible(idx); return; }

  // ---- 3D covariance from quaternion + scale ----
  let xx = qx*qx; let yy = qy*qy; let zz = qz*qz;
  let xy = qx*qy; let xz = qx*qz; let yz = qy*qz;
  let wx = qw*qx; let wy = qw*qy; let wz = qw*qz;

  let rc0 = vec3<f32>(1.0-2.0*(yy+zz), 2.0*(xy+wz), 2.0*(xz-wy));
  let rc1 = vec3<f32>(2.0*(xy-wz), 1.0-2.0*(xx+zz), 2.0*(yz+wx));
  let rc2 = vec3<f32>(2.0*(xz+wy), 2.0*(yz-wx), 1.0-2.0*(xx+yy));

  let m0 = rc0 * sx;
  let m1 = rc1 * sy;
  let m2 = rc2 * sz;

  let s00 = dot(m0,m0); let s01 = dot(m0,m1); let s02 = dot(m0,m2);
  let s11 = dot(m1,m1); let s12 = dot(m1,m2); let s22 = dot(m2,m2);

  // ---- NDC Jacobian: directly maps world perturbation → NDC ----
  // ndc.x = proj[0][0] * cam.x / (-cam.z)
  // ndc.y = proj[1][1] * cam.y / (-cam.z)   (proj[1][1] = -f, already handles y-flip)
  //
  // J_ndc = [[-P00/z, 0,     P00*x/z²],
  //          [0,      -P11/z, P11*y/z²]]
  //
  // T = J_ndc * W   where W = upper-left 3x3 of view matrix

  let W0 = vec3<f32>(u.view[0][0], u.view[1][0], u.view[2][0]); // row 0
  let W1 = vec3<f32>(u.view[0][1], u.view[1][1], u.view[2][1]); // row 1
  let W2 = vec3<f32>(u.view[0][2], u.view[1][2], u.view[2][2]); // row 2

  let P00 = u.proj[0][0];  // f / aspect  (positive)
  let P11 = u.proj[1][1];  // -f          (negative, y-flip)
  let tz = cam.z;           // negative for visible
  let tz2 = tz * tz;

  let j00 = -P00 / tz;
  let j02 =  P00 * cam.x / tz2;
  let j11 = -P11 / tz;
  let j12 =  P11 * cam.y / tz2;

  // T rows (2x3): T0 maps world→NDC_x, T1 maps world→NDC_y
  let T0 = j00 * W0 + j02 * W2;
  let T1 = j11 * W1 + j12 * W2;

  // ---- 2D covariance in NDC: Σ_ndc = T * Σ_3d * T^T ----
  let v00 = s00*T0.x + s01*T0.y + s02*T0.z;
  let v01 = s00*T1.x + s01*T1.y + s02*T1.z;
  let v10 = s01*T0.x + s11*T0.y + s12*T0.z;
  let v11 = s01*T1.x + s11*T1.y + s12*T1.z;
  let v20 = s02*T0.x + s12*T0.y + s22*T0.z;
  let v21 = s02*T1.x + s12*T1.y + s22*T1.z;

  var cov_a = T0.x*v00 + T0.y*v10 + T0.z*v20;
  var cov_b = T0.x*v01 + T0.y*v11 + T0.z*v21;
  var cov_d = T1.x*v01 + T1.y*v11 + T1.z*v21;

  // Low-pass filter (regularize ~0.3px equivalent in NDC)
  let reg = vec2<f32>(0.3 * 2.0 / u.viewport.x, 0.3 * 2.0 / u.viewport.y);
  cov_a += reg.x * reg.x;
  cov_d += reg.y * reg.y;

  // ---- Conic (inverse of 2D cov) in NDC ----
  let det = cov_a * cov_d - cov_b * cov_b;
  if (det <= 0.0) { writeInvisible(idx); return; }
  let inv_det = 1.0 / det;
  let cn_a =  cov_d * inv_det;
  let cn_b = -cov_b * inv_det;
  let cn_d =  cov_a * inv_det;

  // ---- Bounding box (3σ) directly in NDC ----
  let ext_x = 3.0 * sqrt(cov_a);
  let ext_y = 3.0 * sqrt(cov_d);

  if (ext_x < 1e-6 && ext_y < 1e-6) { writeInvisible(idx); return; }

  // ---- NDC center ----
  let clip = u.proj * cam;
  let ndc = clip.xy / clip.w;

  // ---- Write ----
  let base = idx * 12u;
  splatOut[base+0u]  = ndc.x;
  splatOut[base+1u]  = ndc.y;
  splatOut[base+2u]  = ext_x;
  splatOut[base+3u]  = ext_y;
  splatOut[base+4u]  = cn_a;
  splatOut[base+5u]  = cn_b;
  splatOut[base+6u]  = cn_d;
  splatOut[base+7u]  = col.r;
  splatOut[base+8u]  = col.g;
  splatOut[base+9u]  = col.b;
  splatOut[base+10u] = col.a;
  splatOut[base+11u] = -cam.z;

  let depthBits = bitcast<u32>(-cam.z);
  sortKeys[idx] = 0xFFFFFFFFu - floatToSortableUint(depthBits);
  sortValues[idx] = idx;
}

fn writeInvisible(idx: u32) {
  let base = idx * 12u;
  for (var j = 0u; j < 12u; j++) { splatOut[base + j] = 0.0; }
  sortKeys[idx] = 0xFFFFFFFFu;
  sortValues[idx] = idx;
}

fn floatToSortableUint(bits: u32) -> u32 {
  let mask = select(0x80000000u, 0xFFFFFFFFu, (bits & 0x80000000u) != 0u);
  return bits ^ mask;
}

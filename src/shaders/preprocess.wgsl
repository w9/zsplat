// ============================================================
// Preprocess compute shader
// Per-splat: project 3D Gaussian to 2D, compute conic in NDC,
// evaluate SH bands 0-3 for view-dependent color, emit sort keys.
// ============================================================

struct Uniforms {
  view:       mat4x4<f32>,
  proj:       mat4x4<f32>,
  viewport:   vec2<f32>,
  numSplats:  u32,
  hasSH:      u32,
  cameraPos:  vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> positions:  array<f32>;
@group(0) @binding(2) var<storage, read> rotations:  array<f32>;
@group(0) @binding(3) var<storage, read> scales_in:  array<f32>;
@group(0) @binding(4) var<storage, read> colors_in:  array<f32>;
@group(0) @binding(5) var<storage, read> shCoeffs:   array<f32>;  // N*45

// Output: 12 floats per splat
@group(0) @binding(6) var<storage, read_write> splatOut: array<f32>;
@group(0) @binding(7) var<storage, read_write> sortKeys:   array<u32>;
@group(0) @binding(8) var<storage, read_write> sortValues: array<u32>;

// SH constants — signs match PlayCanvas (see gsplatEvalSH.js)
const SH_C1: f32 = 0.4886025119029199;
const SH_C2_0: f32 =  1.0925484305920792;
const SH_C2_1: f32 = -1.0925484305920792;
const SH_C2_2: f32 =  0.31539156525252005;
const SH_C2_3: f32 = -1.0925484305920792;
const SH_C2_4: f32 =  0.5462742152960396;
const SH_C3_0: f32 = -0.5900435899266435;
const SH_C3_1: f32 =  2.890611442640554;
const SH_C3_2: f32 = -0.4570457994644658;
const SH_C3_3: f32 =  0.3731763325901154;
const SH_C3_4: f32 = -0.4570457994644658;
const SH_C3_5: f32 =  1.445305721320277;
const SH_C3_6: f32 = -0.5900435899266435;

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
  var col = vec4<f32>(colors_in[idx*4u], colors_in[idx*4u+1u], colors_in[idx*4u+2u], colors_in[idx*4u+3u]);

  // ---- Evaluate SH for view-dependent color ----
  if (u.hasSH != 0u) {
    let dir = normalize(pos - u.cameraPos.xyz);
    let x = dir.x;
    let y = dir.y;
    let z = dir.z;

    let base = idx * 45u;

    // SH evaluation — matches PlayCanvas gsplatEvalSH.js exactly
    let xx = x * x; let yy = y * y; let zz = z * z;
    let xy = x * y; let yz = y * z; let xz = x * z;

    // Precompute basis function values for all 15 coefficients
    var basis: array<f32, 15>;
    // Band 1 (3)
    basis[0]  = SH_C1 * (-y);
    basis[1]  = SH_C1 * z;
    basis[2]  = SH_C1 * (-x);
    // Band 2 (5)
    basis[3]  = SH_C2_0 * xy;
    basis[4]  = SH_C2_1 * yz;
    basis[5]  = SH_C2_2 * (2.0 * zz - xx - yy);
    basis[6]  = SH_C2_3 * xz;
    basis[7]  = SH_C2_4 * (xx - yy);
    // Band 3 (7)
    basis[8]  = SH_C3_0 * y * (3.0 * xx - yy);
    basis[9]  = SH_C3_1 * xy * z;
    basis[10] = SH_C3_2 * y * (4.0 * zz - xx - yy);
    basis[11] = SH_C3_3 * z * (2.0 * zz - 3.0 * xx - 3.0 * yy);
    basis[12] = SH_C3_4 * x * (4.0 * zz - xx - yy);
    basis[13] = SH_C3_5 * z * (xx - yy);
    basis[14] = SH_C3_6 * x * (xx - 3.0 * yy);

    // Accumulate SH contribution for each color channel
    // Layout: shCoeffs[base + ch*15 + k] where ch=0(R),1(G),2(B), k=0..14
    for (var ch = 0u; ch < 3u; ch++) {
      let o = base + ch * 15u;
      var contrib = 0.0;
      for (var k = 0u; k < 15u; k++) {
        contrib += shCoeffs[o + k] * basis[k];
      }
      // Add directly — no SH_C0 multiplier (matches PlayCanvas)
      if (ch == 0u) { col.x += contrib; }
      else if (ch == 1u) { col.y += contrib; }
      else { col.z += contrib; }
    }

    // Clamp color
    col = vec4<f32>(clamp(col.rgb, vec3<f32>(0.0), vec3<f32>(1.0)), col.a);
  }

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

  let row0 = vec3<f32>(m0.x, m1.x, m2.x);
  let row1 = vec3<f32>(m0.y, m1.y, m2.y);
  let row2 = vec3<f32>(m0.z, m1.z, m2.z);

  let s00 = dot(row0,row0); let s01 = dot(row0,row1); let s02 = dot(row0,row2);
  let s11 = dot(row1,row1); let s12 = dot(row1,row2); let s22 = dot(row2,row2);

  // ---- NDC Jacobian ----
  let W0 = vec3<f32>(u.view[0][0], u.view[1][0], u.view[2][0]);
  let W1 = vec3<f32>(u.view[0][1], u.view[1][1], u.view[2][1]);
  let W2 = vec3<f32>(u.view[0][2], u.view[1][2], u.view[2][2]);

  let P00 = u.proj[0][0];
  let P11 = u.proj[1][1];
  let tz = cam.z;
  let tz2 = tz * tz;

  let j00 = -P00 / tz;
  let j02 =  P00 * cam.x / tz2;
  let j11 = -P11 / tz;
  let j12 =  P11 * cam.y / tz2;

  let T0 = j00 * W0 + j02 * W2;
  let T1 = j11 * W1 + j12 * W2;

  // ---- 2D covariance in NDC ----
  let v00 = s00*T0.x + s01*T0.y + s02*T0.z;
  let v01 = s00*T1.x + s01*T1.y + s02*T1.z;
  let v10 = s01*T0.x + s11*T0.y + s12*T0.z;
  let v11 = s01*T1.x + s11*T1.y + s12*T1.z;
  let v20 = s02*T0.x + s12*T0.y + s22*T0.z;
  let v21 = s02*T1.x + s12*T1.y + s22*T1.z;

  var cov_a = T0.x*v00 + T0.y*v10 + T0.z*v20;
  var cov_b = T0.x*v01 + T0.y*v11 + T0.z*v21;
  var cov_d = T1.x*v01 + T1.y*v11 + T1.z*v21;

  let reg = vec2<f32>(0.3 * 2.0 / u.viewport.x, 0.3 * 2.0 / u.viewport.y);
  cov_a += reg.x * reg.x;
  cov_d += reg.y * reg.y;

  let det = cov_a * cov_d - cov_b * cov_b;
  if (det <= 0.0) { writeInvisible(idx); return; }
  let inv_det = 1.0 / det;
  let cn_a =  cov_d * inv_det;
  let cn_b = -cov_b * inv_det;
  let cn_d =  cov_a * inv_det;

  let ext_x = 3.0 * sqrt(cov_a);
  let ext_y = 3.0 * sqrt(cov_d);

  if (ext_x < 1e-6 && ext_y < 1e-6) { writeInvisible(idx); return; }

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

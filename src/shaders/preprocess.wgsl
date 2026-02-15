// ============================================================
// Preprocess compute shader
// Per-splat: project 3D Gaussian to 2D screen space,
// compute 2D covariance eigendecomposition for quad axes,
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

// Output: preprocessed splat data for rendering
// Per splat: 12 floats packed as 3 vec4's
//   [0]: center_ndc.xy, axis1_ndc.xy
//   [1]: axis2_ndc.xy, color.rg
//   [2]: color.b, opacity, depth (cam-space z), _pad
@group(0) @binding(5) var<storage, read_write> splatOut: array<f32>;

// Sort keys (depth as sortable uint) and values (splat index)
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

  // Frustum / behind-camera cull
  if (camPos.z > -0.1) {
    writeInvisible(idx);
    return;
  }

  // ---- Compute 3D covariance ----
  // Rotation matrix from quaternion
  let xx = qx * qx; let yy = qy * qy; let zz = qz * qz;
  let xy = qx * qy; let xz = qx * qz; let yz = qy * qz;
  let wx = qw * qx; let wy = qw * qy; let wz = qw * qz;

  // R = rotation matrix (column-major vectors)
  let r0 = vec3<f32>(1.0 - 2.0*(yy+zz), 2.0*(xy+wz), 2.0*(xz-wy));
  let r1 = vec3<f32>(2.0*(xy-wz), 1.0 - 2.0*(xx+zz), 2.0*(yz+wx));
  let r2 = vec3<f32>(2.0*(xz+wy), 2.0*(yz-wx), 1.0 - 2.0*(xx+yy));

  // M = R * S  (scale each column of R)
  let m0 = r0 * sx;
  let m1 = r1 * sy;
  let m2 = r2 * sz;

  // 3D covariance Sigma = M * M^T  (symmetric 3x3)
  let cov3d_00 = dot(m0, m0);
  let cov3d_01 = dot(m0, m1);
  let cov3d_02 = dot(m0, m2);
  let cov3d_11 = dot(m1, m1);
  let cov3d_12 = dot(m1, m2);
  let cov3d_22 = dot(m2, m2);

  // ---- Project to 2D ----
  // View matrix upper-left 3x3 (W)
  let W0 = vec3<f32>(u.view[0][0], u.view[1][0], u.view[2][0]);
  let W1 = vec3<f32>(u.view[0][1], u.view[1][1], u.view[2][1]);
  let W2 = vec3<f32>(u.view[0][2], u.view[1][2], u.view[2][2]);

  // Focal lengths from projection matrix
  let fx = u.proj[0][0] * u.viewport.x * 0.5;
  let fy = u.proj[1][1] * u.viewport.y * 0.5;

  let z = camPos.z;
  let z2 = z * z;

  // Jacobian of perspective projection: J = [[fx/z, 0, -fx*x/z^2], [0, fy/z, -fy*y/z^2]]
  // T = J * W  (2x3 matrix)
  let t0 = fx / z;
  let t1 = fy / z;
  let t2 = -fx * camPos.x / z2;
  let t3 = -fy * camPos.y / z2;

  // T = [[t0*W0.x + t2*W2.x, t0*W0.y + t2*W2.y, t0*W0.z + t2*W2.z],
  //      [t1*W1.x + t3*W2.x, t1*W1.y + t3*W2.y, t1*W1.z + t3*W2.z]]
  let T0 = t0 * W0 + t2 * W2;
  let T1 = t1 * W1 + t3 * W2;

  // 2D covariance: Sigma' = T * Sigma_3d * T^T  (symmetric 2x2)
  // First compute V = Sigma_3d * T^T  (3x2)
  let v0 = vec2<f32>(
    cov3d_00 * T0.x + cov3d_01 * T0.y + cov3d_02 * T0.z,
    cov3d_00 * T1.x + cov3d_01 * T1.y + cov3d_02 * T1.z
  );
  let v1 = vec2<f32>(
    cov3d_01 * T0.x + cov3d_11 * T0.y + cov3d_12 * T0.z,
    cov3d_01 * T1.x + cov3d_11 * T1.y + cov3d_12 * T1.z
  );
  let v2 = vec2<f32>(
    cov3d_02 * T0.x + cov3d_12 * T0.y + cov3d_22 * T0.z,
    cov3d_02 * T1.x + cov3d_12 * T1.y + cov3d_22 * T1.z
  );

  // Sigma' = T * V  (2x2 symmetric)
  var cov_a = dot(T0, vec3<f32>(v0.x, v1.x, v2.x));
  var cov_b = dot(T0, vec3<f32>(v0.y, v1.y, v2.y));
  var cov_d = dot(T1, vec3<f32>(v0.y, v1.y, v2.y));

  // Add small regularization for numerical stability
  cov_a += 0.3;
  cov_d += 0.3;

  // ---- Eigendecomposition of 2x2 symmetric matrix [[a,b],[b,d]] ----
  let trace = cov_a + cov_d;
  let det = cov_a * cov_d - cov_b * cov_b;
  let disc = max(0.0001, trace * trace * 0.25 - det);
  let sqrtDisc = sqrt(disc);
  let lambda1 = max(0.0, trace * 0.5 + sqrtDisc);
  let lambda2 = max(0.0, trace * 0.5 - sqrtDisc);

  // Eigenvectors
  var v1_2d = vec2<f32>(1.0, 0.0);
  var v2_2d = vec2<f32>(0.0, 1.0);

  if (abs(cov_b) > 1e-6) {
    v1_2d = normalize(vec2<f32>(cov_b, lambda1 - cov_a));
    v2_2d = normalize(vec2<f32>(cov_b, lambda2 - cov_a));
  } else if (cov_a >= cov_d) {
    v1_2d = vec2<f32>(1.0, 0.0);
    v2_2d = vec2<f32>(0.0, 1.0);
  } else {
    v1_2d = vec2<f32>(0.0, 1.0);
    v2_2d = vec2<f32>(1.0, 0.0);
  }

  // 3-sigma extent in pixels
  let r1 = 3.0 * sqrt(lambda1);
  let r2_val = 3.0 * sqrt(lambda2);

  // Cull tiny splats
  if (r1 < 0.1 && r2_val < 0.1) {
    writeInvisible(idx);
    return;
  }

  // Clamp max radius to avoid huge quads
  let maxRadius = max(r1, r2_val);
  if (maxRadius > u.viewport.x * 2.0) {
    writeInvisible(idx);
    return;
  }

  // ---- Compute screen-space axes in NDC ----
  let clip = u.proj * cam;
  let ndc = clip.xy / clip.w;

  // Convert pixel axes to NDC
  let pixToNdc = vec2<f32>(2.0 / u.viewport.x, 2.0 / u.viewport.y);
  let axis1 = v1_2d * r1 * pixToNdc;
  let axis2 = v2_2d * r2_val * pixToNdc;

  // ---- Write output ----
  let base = idx * 12u;
  // vec4[0]: center_ndc.xy, axis1_ndc.xy
  splatOut[base + 0u] = ndc.x;
  splatOut[base + 1u] = ndc.y;
  splatOut[base + 2u] = axis1.x;
  splatOut[base + 3u] = axis1.y;
  // vec4[1]: axis2_ndc.xy, color.rg
  splatOut[base + 4u] = axis2.x;
  splatOut[base + 5u] = axis2.y;
  splatOut[base + 6u] = col.r;
  splatOut[base + 7u] = col.g;
  // vec4[2]: color.b, opacity, depth, _pad
  splatOut[base + 8u] = col.b;
  splatOut[base + 9u] = col.a;
  splatOut[base + 10u] = -camPos.z; // positive depth for sorting
  splatOut[base + 11u] = 0.0;

  // ---- Sort key: float depth → sortable uint (back-to-front) ----
  let depth = -camPos.z;
  // Convert float to uint that sorts in increasing order
  let depthBits = bitcast<u32>(depth);
  // Flip for back-to-front: larger depth (farther) should come first (smaller key)
  let sortKey = 0xFFFFFFFFu - floatToSortableUint(depthBits);
  sortKeys[idx] = sortKey;
  sortValues[idx] = idx;
}

fn writeInvisible(idx: u32) {
  let base = idx * 12u;
  // Zero-size axes → invisible quad
  for (var j = 0u; j < 12u; j++) {
    splatOut[base + j] = 0.0;
  }
  // Place behind everything with max sort key
  sortKeys[idx] = 0xFFFFFFFFu;
  sortValues[idx] = idx;
}

fn floatToSortableUint(bits: u32) -> u32 {
  // IEEE 754 float → sortable uint:
  // If sign bit is set, flip all bits; otherwise flip just sign bit
  let mask = select(0x80000000u, 0xFFFFFFFFu, (bits & 0x80000000u) != 0u);
  return bits ^ mask;
}

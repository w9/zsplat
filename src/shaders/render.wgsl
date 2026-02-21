// ============================================================
// Render shader — vertex + fragment
// Draws sorted Gaussian splats as screen-aligned quads.
// The fragment shader evaluates the full elliptical Gaussian
// using the conic (inverse 2D covariance) in NDC space.
// ============================================================

// Preprocessed splat data (12 floats per splat):
//   [0]:  center_ndc.x
//   [1]:  center_ndc.y
//   [2]:  extent_ndc.x  (half-width of bounding quad)
//   [3]:  extent_ndc.y  (half-height)
//   [4]:  conic_ndc.x   (inverse cov [0][0])
//   [5]:  conic_ndc.y   (inverse cov [0][1])
//   [6]:  conic_ndc.z   (inverse cov [1][1])
//   [7]:  color.r
//   [8]:  color.g
//   [9]:  color.b
//   [10]: opacity
//   [11]: depth
@group(0) @binding(0) var<storage, read> splatData:     array<f32>;
@group(0) @binding(1) var<storage, read> sortedIndices: array<u32>;

struct VertexOut {
  @builtin(position) pos:   vec4<f32>,
  @location(0) d_ndc:       vec2<f32>,  // offset from splat center in NDC
  @location(1) color:       vec4<f32>,  // rgb + opacity
  @location(2) conic:       vec3<f32>,  // conic in NDC: (a, b, d)
  @location(3) @interpolate(flat) splatIdx: u32,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIdx: u32,
  @builtin(instance_index) instanceIdx: u32,
) -> VertexOut {
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );
  let corner = corners[vertexIdx];

  let splatIdx = sortedIndices[instanceIdx];
  let base = splatIdx * 12u;

  let center  = vec2<f32>(splatData[base + 0u], splatData[base + 1u]);
  let extent  = vec2<f32>(splatData[base + 2u], splatData[base + 3u]);
  let cn      = vec3<f32>(splatData[base + 4u], splatData[base + 5u], splatData[base + 6u]);
  let r       = splatData[base + 7u];
  let g       = splatData[base + 8u];
  let b       = splatData[base + 9u];
  let opacity = splatData[base + 10u];

  // Position quad corner
  let offset = extent * corner;
  let pos_ndc = center + offset;

  var out: VertexOut;
  out.pos = vec4<f32>(pos_ndc, 0.0, 1.0);
  out.d_ndc = offset;
  out.color = vec4<f32>(r, g, b, opacity);
  out.conic = cn;
  out.splatIdx = splatIdx;
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  let d = in.d_ndc;

  // Evaluate Gaussian: exp(-0.5 * d^T * conic * d)
  let power = -0.5 * (in.conic.x * d.x * d.x + 2.0 * in.conic.y * d.x * d.y + in.conic.z * d.y * d.y);

  // power should be negative (conic is positive-definite inverse)
  if (power > 0.0) {
    discard;
  }

  let gaussian = exp(power);
  let alpha = in.color.a * gaussian;

  if (alpha < 1.0 / 255.0) {
    discard;
  }

  // Premultiplied alpha
  return vec4<f32>(in.color.rgb * alpha, alpha);
}

@fragment
fn fs_pick(in: VertexOut) -> @location(0) vec4<u32> {
  let d = in.d_ndc;
  let power = -0.5 * (in.conic.x * d.x * d.x + 2.0 * in.conic.y * d.x * d.y + in.conic.z * d.y * d.y);
  if (power > 0.0) {
    discard;
  }
  let gaussian = exp(power);
  let alpha = in.color.a * gaussian;
  if (alpha < 1.0 / 255.0) {
    discard;
  }
  return vec4<u32>(in.splatIdx, 0u, 0u, 0u);
}

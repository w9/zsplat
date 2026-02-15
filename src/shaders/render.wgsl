// ============================================================
// Render shader — vertex + fragment
// Draws sorted Gaussian splats as screen-aligned quads with
// Gaussian alpha falloff.
// ============================================================

// Preprocessed splat data (12 floats per splat, 3 x vec4)
//   [0]: center_ndc.xy, axis1_ndc.xy
//   [1]: axis2_ndc.xy, color.rg
//   [2]: color.b, opacity, depth, _pad
@group(0) @binding(0) var<storage, read> splatData:    array<f32>;
@group(0) @binding(1) var<storage, read> sortedIndices: array<u32>;

struct VertexOut {
  @builtin(position) pos: vec4<f32>,
  @location(0) uv:    vec2<f32>,
  @location(1) color: vec4<f32>,
};

@vertex
fn vs_main(
  @builtin(vertex_index) vertexIdx: u32,
  @builtin(instance_index) instanceIdx: u32,
) -> VertexOut {
  // 6 vertices per quad: 2 triangles
  // 0,1,2  and  2,1,3
  var corners = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>(-1.0,  1.0),
    vec2<f32>( 1.0, -1.0),
    vec2<f32>( 1.0,  1.0),
  );

  let corner = corners[vertexIdx];

  // Look up the sorted splat index
  let splatIdx = sortedIndices[instanceIdx];
  let base = splatIdx * 12u;

  // Read preprocessed data
  let center = vec2<f32>(splatData[base + 0u], splatData[base + 1u]);
  let axis1  = vec2<f32>(splatData[base + 2u], splatData[base + 3u]);
  let axis2  = vec2<f32>(splatData[base + 4u], splatData[base + 5u]);
  let r      = splatData[base + 6u];
  let g      = splatData[base + 7u];
  let b      = splatData[base + 8u];
  let a      = splatData[base + 9u];

  // Position the quad corner
  let worldPos = center + axis1 * corner.x + axis2 * corner.y;

  var out: VertexOut;
  out.pos = vec4<f32>(worldPos, 0.0, 1.0);
  out.uv = corner;
  out.color = vec4<f32>(r, g, b, a);
  return out;
}

@fragment
fn fs_main(in: VertexOut) -> @location(0) vec4<f32> {
  // Gaussian falloff: exp(-4.5 * r²) where UV ∈ [-1,1] maps to 3σ
  let r2 = dot(in.uv, in.uv);

  // Early discard beyond 3σ
  if (r2 > 1.0) {
    discard;
  }

  let gaussian = exp(-4.5 * r2);
  let alpha = in.color.a * gaussian;

  // Discard very transparent fragments
  if (alpha < 1.0 / 255.0) {
    discard;
  }

  // Premultiplied alpha output
  return vec4<f32>(in.color.rgb * alpha, alpha);
}

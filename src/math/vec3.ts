export type Vec3 = [number, number, number];

export function vec3Normalize(out: Vec3, v: Vec3): Vec3 {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  out[0] = v[0] / len;
  out[1] = v[1] / len;
  out[2] = v[2] / len;
  return out;
}

export function vec3Cross(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  const ax = a[0];
  const ay = a[1];
  const az = a[2];
  const bx = b[0];
  const by = b[1];
  const bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
}

export function vec3Subtract(out: Vec3, a: Vec3, b: Vec3): Vec3 {
  out[0] = a[0] - b[0];
  out[1] = a[1] - b[1];
  out[2] = a[2] - b[2];
  return out;
}

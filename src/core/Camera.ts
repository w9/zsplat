/**
 * Orbit camera with mouse/touch/wheel interaction and smooth damping.
 * Produces view and projection matrices as Float32Array(16).
 */
export class Camera {
  // Spherical coordinates
  private theta: number;   // azimuth (radians)
  private phi: number;     // polar angle (radians) from top
  private radius: number;  // distance from target
  private target: [number, number, number];

  // Velocity for smooth damping
  private vTheta = 0;
  private vPhi = 0;
  private vRadius = 0;
  private vPanX = 0;
  private vPanY = 0;
  private vPanForward = 0;

  /** Radians per frame for automatic orbit (turntable). 0 = off. */
  turntableSpeed = 0;

  private fov: number;   // vertical FOV in degrees
  private near: number;
  private far: number;
  private aspect = 1;

  private canvas: HTMLCanvasElement | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private keysDown = new Set<string>();
  private lastPinchDist = 0;
  private dirty = true;

  private _view = new Float32Array(16);
  private _proj = new Float32Array(16);
  private _viewProj = new Float32Array(16);
  private _position: [number, number, number] = [0, 0, 0];

  /** Stored initial pose (set in constructor and by fitToBounds) for R = reset */
  private initialTarget: [number, number, number];
  private initialTheta: number;
  private initialPhi: number;
  private initialRadius: number;

  /** 'orbit' = drag orbits camera around target; 'fly' = drag rotates view in place. */
  private controlMode: 'orbit' | 'fly' = 'orbit';
  /** In fly mode: camera position. In orbit mode: null. */
  private _flyPosition: [number, number, number] | null = null;

  // Bound handlers for cleanup
  private onPointerDownBound: (e: PointerEvent) => void;
  private onPointerMoveBound: (e: PointerEvent) => void;
  private onPointerUpBound: (e: PointerEvent) => void;
  private onWheelBound: (e: WheelEvent) => void;
  private onKeyDownBound: (e: KeyboardEvent) => void;
  private onKeyUpBound: (e: KeyboardEvent) => void;

  constructor(options?: {
    position?: [number, number, number];
    target?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
  }) {
    this.target = options?.target ?? [0, 0, 0];
    this.fov = options?.fov ?? 60;
    this.near = options?.near ?? 0.01;
    this.far = options?.far ?? 1000;

    // Compute spherical coords from position
    const pos = options?.position ?? [0, 1, -5];
    const dx = pos[0] - this.target[0];
    const dy = pos[1] - this.target[1];
    const dz = pos[2] - this.target[2];
    this.radius = Math.sqrt(dx * dx + dy * dy + dz * dz) || 3;
    this.phi = Math.acos(Math.max(-1, Math.min(1, dy / this.radius)));
    this.theta = Math.atan2(dx, dz);

    this.initialTarget = [...this.target];
    this.initialTheta = this.theta;
    this.initialPhi = this.phi;
    this.initialRadius = this.radius;

    this.onPointerDownBound = this.onPointerDown.bind(this);
    this.onPointerMoveBound = this.onPointerMove.bind(this);
    this.onPointerUpBound = this.onPointerUp.bind(this);
    this.onWheelBound = this.onWheel.bind(this);
    this.onKeyDownBound = this.onKeyDown.bind(this);
    this.onKeyUpBound = this.onKeyUp.bind(this);
  }

  attach(canvas: HTMLCanvasElement): void {
    this.canvas = canvas;
    canvas.tabIndex = 0;
    canvas.addEventListener('pointerdown', this.onPointerDownBound);
    canvas.addEventListener('pointermove', this.onPointerMoveBound);
    canvas.addEventListener('pointerup', this.onPointerUpBound);
    canvas.addEventListener('pointercancel', this.onPointerUpBound);
    canvas.addEventListener('wheel', this.onWheelBound, { passive: false });
    canvas.addEventListener('keydown', this.onKeyDownBound);
    canvas.addEventListener('keyup', this.onKeyUpBound);
    canvas.style.touchAction = 'none';
  }

  detach(): void {
    if (!this.canvas) return;
    this.canvas.removeEventListener('pointerdown', this.onPointerDownBound);
    this.canvas.removeEventListener('pointermove', this.onPointerMoveBound);
    this.canvas.removeEventListener('pointerup', this.onPointerUpBound);
    this.canvas.removeEventListener('pointercancel', this.onPointerUpBound);
    this.canvas.removeEventListener('wheel', this.onWheelBound);
    this.canvas.removeEventListener('keydown', this.onKeyDownBound);
    this.canvas.removeEventListener('keyup', this.onKeyUpBound);
    this.keysDown.clear();
    this.canvas = null;
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
    this.dirty = true;
  }

  setControlMode(mode: 'orbit' | 'fly'): void {
    if (this.controlMode === mode) return;
    this.controlMode = mode;
    if (mode === 'fly') {
      this._flyPosition = [...this._position];
    } else {
      this._flyPosition = null;
    }
    this.dirty = true;
  }

  /** Call once per frame to apply damping and update matrices. Returns true if changed. */
  update(): boolean {
    const damping = 0.85;
    const threshold = 1e-5;

    // WASD + Q/E keyboard pan: Shift = 10x slower, Alt/Cmd = 10x faster
    const keySpeed = this.radius * 0.004;
    let speedMul = 1;
    if (this.keysDown.has('shift')) speedMul *= 0.1;
    if (this.keysDown.has('alt') || this.keysDown.has('meta')) speedMul *= 10;
    const step = keySpeed * speedMul;
    if (this.keysDown.has('w')) { this.vPanForward += step; this.dirty = true; }
    if (this.keysDown.has('s')) { this.vPanForward -= step; this.dirty = true; }
    if (this.keysDown.has('a')) { this.vPanX += step; this.dirty = true; }
    if (this.keysDown.has('d')) { this.vPanX -= step; this.dirty = true; }
    if (this.keysDown.has('q')) { this.vPanY -= step; this.dirty = true; }
    if (this.keysDown.has('e')) { this.vPanY += step; this.dirty = true; }

    this.theta += this.vTheta;
    if (this.turntableSpeed !== 0) {
      this.theta += this.turntableSpeed;
      this.dirty = true;
    }
    this.phi += this.vPhi;
    this.radius += this.vRadius;

    // Pan in camera-space (right, up, and view direction)
    if (
      Math.abs(this.vPanX) > threshold ||
      Math.abs(this.vPanY) > threshold ||
      Math.abs(this.vPanForward) > threshold
    ) {
      const right = this.getRightDir();
      const up = this.getUpDir();
      const viewDir = this.getViewDir();
      const dx =
        right[0] * this.vPanX +
        up[0] * this.vPanY +
        viewDir[0] * this.vPanForward;
      const dy =
        right[1] * this.vPanX +
        up[1] * this.vPanY +
        viewDir[1] * this.vPanForward;
      const dz =
        right[2] * this.vPanX +
        up[2] * this.vPanY +
        viewDir[2] * this.vPanForward;
      if (this.controlMode === 'fly' && this._flyPosition) {
        this._flyPosition[0] += dx;
        this._flyPosition[1] += dy;
        this._flyPosition[2] += dz;
      } else {
        this.target[0] += dx;
        this.target[1] += dy;
        this.target[2] += dz;
      }
      this.dirty = true;
    }

    this.vTheta *= damping;
    this.vPhi *= damping;
    this.vRadius *= damping;
    this.vPanX *= damping;
    this.vPanY *= damping;
    this.vPanForward *= damping;

    // Clamp
    this.phi = Math.max(0.01, Math.min(Math.PI - 0.01, this.phi));
    this.radius = Math.max(0.01, this.radius);

    const anyVelocity =
      Math.abs(this.vTheta) > threshold ||
      Math.abs(this.vPhi) > threshold ||
      Math.abs(this.vRadius) > threshold ||
      Math.abs(this.vPanX) > threshold ||
      Math.abs(this.vPanY) > threshold ||
      Math.abs(this.vPanForward) > threshold;

    if (anyVelocity || this.dirty) {
      this.dirty = false;
      this.rebuildMatrices();
      return true;
    }
    return false;
  }

  get position(): [number, number, number] {
    return this._position;
  }

  get viewMatrix(): Float32Array {
    return this._view;
  }

  get projMatrix(): Float32Array {
    return this._proj;
  }

  get viewProjMatrix(): Float32Array {
    return this._viewProj;
  }

  /** Update camera from external camera state */
  setFromState(state: {
    position?: [number, number, number];
    target?: [number, number, number];
    fov?: number;
    near?: number;
    far?: number;
  }): void {
    if (state.target) this.target = [...state.target];
    if (state.fov) this.fov = state.fov;
    if (state.near) this.near = state.near;
    if (state.far) this.far = state.far;
    if (state.position) {
      const dx = state.position[0] - this.target[0];
      const dy = state.position[1] - this.target[1];
      const dz = state.position[2] - this.target[2];
      this.radius = Math.sqrt(dx * dx + dy * dy + dz * dz) || 3;
      this.phi = Math.acos(Math.max(-1, Math.min(1, dy / this.radius)));
      this.theta = Math.atan2(dx, dz);
    }
    this.dirty = true;
  }

  /** Reset camera to look at scene bounds */
  fitToBounds(min: [number, number, number], max: [number, number, number]): void {
    this.target = [
      (min[0] + max[0]) * 0.5,
      (min[1] + max[1]) * 0.5,
      (min[2] + max[2]) * 0.5,
    ];
    const extent = Math.max(
      max[0] - min[0],
      max[1] - min[1],
      max[2] - min[2],
    );
    this.radius = extent * 1.5 + 0.01;
    this.phi = Math.PI * 0.45;
    this.theta = Math.PI * 0.25;
    this.near = Math.max(0.01, extent / 200);
    this.far = extent * 20;
    this.vTheta = this.vPhi = this.vRadius = this.vPanX = this.vPanY = this.vPanForward = 0;
    this.initialTarget = [...this.target];
    this.initialTheta = this.theta;
    this.initialPhi = this.phi;
    this.initialRadius = this.radius;
    this.syncFlyPositionFromOrbit();
    this.dirty = true;
  }

  /** Reset camera to the stored initial pose (R key). */
  resetToInitial(): void {
    this.target = [...this.initialTarget];
    this.theta = this.initialTheta;
    this.phi = this.initialPhi;
    this.radius = this.initialRadius;
    this.vTheta = this.vPhi = this.vRadius = this.vPanX = this.vPanY = this.vPanForward = 0;
    this.syncFlyPositionFromOrbit();
    this.dirty = true;
  }

  /** Set _flyPosition from current target/theta/phi/radius so fly mode matches. */
  private syncFlyPositionFromOrbit(): void {
    if (this.controlMode !== 'fly') return;
    const sp = Math.sin(this.phi);
    const cp = Math.cos(this.phi);
    const st = Math.sin(this.theta);
    const ct = Math.cos(this.theta);
    if (!this._flyPosition) this._flyPosition = [0, 0, 0];
    this._flyPosition[0] = this.target[0] + this.radius * sp * st;
    this._flyPosition[1] = this.target[1] + this.radius * cp;
    this._flyPosition[2] = this.target[2] + this.radius * sp * ct;
  }

  // ---- private ----

  private rebuildMatrices(): void {
    const sp = Math.sin(this.phi);
    const cp = Math.cos(this.phi);
    const st = Math.sin(this.theta);
    const ct = Math.cos(this.theta);
    const dirX = sp * st;
    const dirY = cp;
    const dirZ = sp * ct;

    if (this.controlMode === 'fly' && this._flyPosition) {
      this._position[0] = this._flyPosition[0];
      this._position[1] = this._flyPosition[1];
      this._position[2] = this._flyPosition[2];
      this.target[0] = this._position[0] - this.radius * dirX;
      this.target[1] = this._position[1] - this.radius * dirY;
      this.target[2] = this._position[2] - this.radius * dirZ;
    } else {
      this._position[0] = this.target[0] + this.radius * dirX;
      this._position[1] = this.target[1] + this.radius * dirY;
      this._position[2] = this.target[2] + this.radius * dirZ;
    }

    lookAt(this._view, this._position, this.target, [0, 1, 0]);

    // Projection matrix
    const fovRad = (this.fov * Math.PI) / 180;
    perspective(this._proj, fovRad, this.aspect, this.near, this.far);

    // viewProj
    mat4Mul(this._viewProj, this._proj, this._view);
  }

  private getRightDir(): [number, number, number] {
    return [this._view[0], this._view[4], this._view[8]];
  }

  private getUpDir(): [number, number, number] {
    return [this._view[1], this._view[5], this._view[9]];
  }

  /** View direction from camera to target (normalized). */
  private getViewDir(): [number, number, number] {
    let zx = this.target[0] - this._position[0];
    let zy = this.target[1] - this._position[1];
    let zz = this.target[2] - this._position[2];
    const len = Math.hypot(zx, zy, zz) || 1;
    zx /= len;
    zy /= len;
    zz /= len;
    return [zx, zy, zz];
  }

  // ---- event handlers ----

  private onPointerDown(e: PointerEvent): void {
    this.canvas?.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const pts = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;

    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    prev.x = e.clientX;
    prev.y = e.clientY;

    if (this.pointers.size === 2) {
      // Pinch zoom
      const pts = [...this.pointers.values()];
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      if (this.lastPinchDist > 0) {
        const scale = this.lastPinchDist / dist;
        this.vRadius += this.radius * (scale - 1) * 0.5;
        this.dirty = true;
      }
      this.lastPinchDist = dist;
      return;
    }

    const sens = 0.003;

    if (e.buttons & 2 || e.buttons & 4 || (e.buttons & 1 && e.shiftKey)) {
      // Right-click or middle-click or shift+left: pan
      const panScale = this.radius * 0.001;
      this.vPanX -= dx * panScale;
      this.vPanY += dy * panScale;
      this.dirty = true;
    } else if (e.buttons & 1) {
      // Left-click: orbit
      this.vTheta += dx * sens;
      this.vPhi += dy * sens;
      this.dirty = true;
    }
  }

  private onPointerUp(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) {
      this.lastPinchDist = 0;
    }
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    this.vRadius += e.deltaY * this.radius * 0.001;
    this.dirty = true;
  }

  private onKeyDown(e: KeyboardEvent): void {
    const key = e.key.toLowerCase();
    if (key === 'r') {
      this.resetToInitial();
      return;
    }
    this.keysDown.add(key);
  }

  private onKeyUp(e: KeyboardEvent): void {
    this.keysDown.delete(e.key.toLowerCase());
  }
}

// ---- inline mat4 helpers ----

function lookAt(
  out: Float32Array,
  eye: [number, number, number],
  target: [number, number, number],
  up: [number, number, number],
): void {
  let zx = eye[0] - target[0];
  let zy = eye[1] - target[1];
  let zz = eye[2] - target[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;

  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;

  out[0] = xx; out[1] = yx; out[2] = zx; out[3] = 0;
  out[4] = xy; out[5] = yy; out[6] = zy; out[7] = 0;
  out[8] = xz; out[9] = yz; out[10] = zz; out[11] = 0;
  out[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  out[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  out[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  out[15] = 1;
}

function perspective(
  out: Float32Array,
  fovy: number,
  aspect: number,
  near: number,
  far: number,
): void {
  const f = 1.0 / Math.tan(fovy / 2);
  out[0] = -f / aspect; // negate x — match PLY data convention
  out[1] = 0; out[2] = 0; out[3] = 0;
  out[4] = 0;
  out[5] = -f; // negate y — WebGPU framebuffer y is top-down
  out[6] = 0; out[7] = 0;
  out[8] = 0; out[9] = 0;
  out[10] = far / (near - far);
  out[11] = -1;
  out[12] = 0; out[13] = 0;
  out[14] = (near * far) / (near - far);
  out[15] = 0;
}

function mat4Mul(out: Float32Array, a: Float32Array, b: Float32Array): void {
  for (let i = 0; i < 4; i++) {
    const ai0 = a[i], ai1 = a[i + 4], ai2 = a[i + 8], ai3 = a[i + 12];
    out[i]      = ai0 * b[0]  + ai1 * b[1]  + ai2 * b[2]  + ai3 * b[3];
    out[i + 4]  = ai0 * b[4]  + ai1 * b[5]  + ai2 * b[6]  + ai3 * b[7];
    out[i + 8]  = ai0 * b[8]  + ai1 * b[9]  + ai2 * b[10] + ai3 * b[11];
    out[i + 12] = ai0 * b[12] + ai1 * b[13] + ai2 * b[14] + ai3 * b[15];
  }
}

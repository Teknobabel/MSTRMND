/**
 * The four-by-four matrix math the map camera needs, and nothing else.
 *
 * Column-major throughout — the layout `uniformMatrix4fv` takes without a transpose — so the
 * same array goes to the GPU and to `projectMatrix` unchanged. That shared array is the whole
 * trick behind the map: the art and the pins on top of it cannot disagree about where a site
 * is, because they are read through the same sixteen numbers.
 *
 * Index an element as `m[column * 4 + row]`.
 */

export type Mat4 = Float32Array;

export function identity(): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** `a * b` — the transform that applies `b` first, then `a`. */
export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) {
        sum += a[k * 4 + row]! * b[col * 4 + k]!;
      }
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

/** Right-handed perspective looking down -z, the usual GL convention. */
export function perspective(
  fovYRadians: number,
  aspect: number,
  near: number,
  far: number,
): Mat4 {
  const f = 1 / Math.tan(fovYRadians / 2);
  const range = 1 / (near - far);
  // prettier-ignore
  return new Float32Array([
    f / aspect, 0, 0, 0,
    0, f, 0, 0,
    0, 0, (far + near) * range, -1,
    0, 0, 2 * far * near * range, 0,
  ]);
}

export function translation(x: number, y: number, z: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ]);
}

export function rotationX(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  // prettier-ignore
  return new Float32Array([
    1, 0, 0, 0,
    0, c, s, 0,
    0, -s, c, 0,
    0, 0, 0, 1,
  ]);
}

export function rotationY(radians: number): Mat4 {
  const c = Math.cos(radians);
  const s = Math.sin(radians);
  // prettier-ignore
  return new Float32Array([
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    0, 0, 0, 1,
  ]);
}

/**
 * A scale applied to clip-space x and y only, leaving z and w alone.
 *
 * Multiplied on the *left* of a finished camera it zooms the framing without touching the
 * perspective divide, which is what lets the map be fitted to the panel after the tilt is
 * known rather than solved for analytically.
 */
export function clipScale(scale: number): Mat4 {
  // prettier-ignore
  return new Float32Array([
    scale, 0, 0, 0,
    0, scale, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ]);
}

/** `m * (x, y, z, w)`, column-major. */
export function transformVec4(
  m: Mat4,
  x: number,
  y: number,
  z: number,
  w: number,
): [number, number, number, number] {
  return [
    m[0]! * x + m[4]! * y + m[8]! * z + m[12]! * w,
    m[1]! * x + m[5]! * y + m[9]! * z + m[13]! * w,
    m[2]! * x + m[6]! * y + m[10]! * z + m[14]! * w,
    m[3]! * x + m[7]! * y + m[11]! * z + m[15]! * w,
  ];
}

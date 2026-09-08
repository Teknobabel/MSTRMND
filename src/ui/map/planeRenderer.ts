import type { Mat4 } from "./mat4";
import type { PlotSize } from "./projection";
import type { MapSiteSignal } from "./siteSignals";

/**
 * The map, drawn on the GPU as a stack of planes a camera looks at.
 *
 * Two layers share one unit-square quad and one camera, separated only by how far each floats
 * above the land (see `camera.ts`):
 *
 * - **land** — the authored art, drawn opaque.
 * - **grid** — procedural meridians and a slow sweep, drawn additively a little above it.
 *
 * The parallax between them as the camera drifts is the whole illusion; neither layer on its
 * own reads as anything but a picture. The pins on top are DOM, projected through the same
 * `land` matrix, so they stay glued to their sites through all of it.
 *
 * Everything here degrades rather than fails. Some devices have no WebGL2, contexts are lost
 * when a phone backgrounds a tab or a GPU driver resets, and art can 404; each of those calls
 * `onFallback` and the panel goes back to the plain image layer it always had.
 */

const LAND_VERTEX_SRC = `#version 300 es
in vec2 a_uv;
uniform mat4 u_mvp;
out vec2 v_uv;
void main() {
  v_uv = a_uv;
  gl_Position = u_mvp * vec4(a_uv, 0.0, 1.0);
}
`;

const LAND_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform sampler2D u_art;
out vec4 fragColor;
void main() {
  fragColor = texture(u_art, v_uv);
}
`;

/**
 * Meridians and parallels rather than an abstract grid: the art underneath is a world map, and
 * a lat/long lattice reinforces that reading instead of fighting it. Output is premultiplied so
 * the layer can be blended with a plain additive `ONE, ONE` onto the premultiplied canvas.
 */
const GRID_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_uv;
uniform float u_time;
uniform vec2 u_cells;
out vec4 fragColor;

const vec3 ACCENT = vec3(0.91, 0.07, 0.18);

/* Screen-space derivative keeps a line one pixel wide however far the plane is tilted away —
 * without it the far edge of the map turns into a moire of aliased lines. */
float lattice(vec2 uv, vec2 cells) {
  vec2 scaled = uv * cells;
  vec2 distance = abs(fract(scaled - 0.5) - 0.5) / max(fwidth(scaled), vec2(1e-5));
  return 1.0 - min(min(distance.x, distance.y), 1.0);
}

void main() {
  float lines = lattice(v_uv, u_cells);

  /* One slow pass of a soft band, so the layer reads as something live rather than a decal. */
  float head = fract(u_time * 0.055) * 1.25 - 0.125;
  float sweep = exp(-pow((v_uv.x - head) / 0.11, 2.0));

  /* Fade out at the slab's edges; a lattice that stops dead gives away that it is a quad. */
  vec2 fade = smoothstep(vec2(0.0), vec2(0.07), v_uv)
            * smoothstep(vec2(0.0), vec2(0.07), 1.0 - v_uv);
  float edge = fade.x * fade.y;

  /* Kept deliberately faint. The lattice is here to give the camera something to have a
   * parallax against, not to be looked at; at the brightness it takes to read as a feature in
   * its own right it simply erases the map underneath as the sweep goes past. */
  float alpha = edge * (lines * (0.05 + 0.16 * sweep) + sweep * 0.014);
  fragColor = vec4(ACCENT * alpha, alpha);
}
`;

/**
 * A glow sitting on the land at one site.
 *
 * The quad is built around the site in the vertex shader rather than covering the whole map,
 * so the cost is a handful of small draws over the lit sites instead of a loop over every site
 * for every pixel of the panel. `u_aspect` undoes the slab's stretch, so a circle in slab space
 * stays a circle rather than becoming an ellipse the width of the map.
 */
const GLOW_VERTEX_SRC = `#version 300 es
in vec2 a_uv;
uniform mat4 u_mvp;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_aspect;
out vec2 v_local;
void main() {
  v_local = a_uv * 2.0 - 1.0;
  vec2 mapPos = u_center + v_local * vec2(u_radius / u_aspect, u_radius);
  gl_Position = u_mvp * vec4(mapPos, 0.0, 1.0);
}
`;

/**
 * Three things a site can be saying, in three colours the player can tell apart at a glance:
 * hardened (amber, steady), an operation running (accent, pulsing), staged as the target
 * (near-white, brightest). Premultiplied additive, like the lattice.
 */
const GLOW_FRAGMENT_SRC = `#version 300 es
precision mediump float;
in vec2 v_local;
uniform vec3 u_levels;
uniform float u_time;
out vec4 fragColor;

/* Warm and steady for a fact about the site; cool and breathing for something the player has in
 * motion. On art that is red from edge to edge, hue is the only thing that separates an
 * operation from the map underneath it — a red glow on a red map stays invisible however bright
 * it gets, which is exactly how the first version of this shader failed. */
const vec3 SECURITY = vec3(1.0, 0.5, 0.12);
const vec3 OPERATION = vec3(0.25, 0.85, 1.0);
const vec3 TARGETED = vec3(0.9, 0.94, 1.0);

void main() {
  float d = length(v_local);
  if (d > 1.0) {
    discard;
  }
  /* Squared falloff reads as light rather than as a disc with a soft edge. */
  float falloff = pow(1.0 - d, 2.0);

  /* Security is a fact about the site and holds still. An operation is in progress, so it
   * breathes. The staged target gets a faster pulse so the eye goes to it first. */
  float operationPulse = 0.62 + 0.38 * sin(u_time * 2.1);
  float targetPulse = 0.70 + 0.30 * sin(u_time * 3.4);

  /* Security arrives as a fraction of a ceiling only one, two or three steps tall, so its
   * lowest useful step can be a third. Left linear, that first step of hardening is invisible;
   * the curve lifts it into view without lifting zero off the floor. */
  float security = pow(u_levels.x, 0.6) * 0.34;
  /* Both of these are things the player did this turn and needs to find quickly, so they carry
   * more weight than the ambient hardening underneath them. */
  float operation = u_levels.y * 0.52 * operationPulse;
  float targeted = u_levels.z * 0.34 * targetPulse;

  vec3 colour = SECURITY * security + OPERATION * operation + TARGETED * targeted;
  float alpha = min(security + operation + targeted, 1.0);
  fragColor = vec4(colour * falloff, alpha * falloff);
}
`;

/**
 * Backing-store cap. The stage is already one large composited layer (see `ui/stageScale`), and
 * a phone does not need a 3x map to read fifteen dots.
 */
const MAX_PIXEL_RATIO = 2;

/** Meridians and parallels. Roughly 15 degrees of longitude per column on the shipped art. */
const GRID_CELLS: readonly [number, number] = [24, 12];

/** Glow radius in slab half-heights. Wide enough to read as a bloom, tight enough that two
 *  neighbouring sites do not merge into one smear. */
const GLOW_RADIUS = 0.19;

export interface MapFrame {
  /** Camera for the land plane — the same matrix the markers are projected through. */
  readonly land: Mat4;
  /** Camera for the grid plane floating above it. */
  readonly grid: Mat4;
  /** Seconds since the map opened, for the sweep and the pulses. */
  readonly timeSeconds: number;
  /** Panel aspect, so a glow stays round on the stretched slab. */
  readonly aspect: number;
  /** What each lit site is saying. Empty on a run where nothing has happened yet. */
  readonly signals: readonly MapSiteSignal[];
}

export interface MapPlaneRenderer {
  /** The layer to put in the plot, in place of `.map-plot__art`. */
  readonly canvas: HTMLCanvasElement;
  /** True once the art has decoded, so a draw will show something. */
  ready(): boolean;
  /** Size the backing store; a no-op when nothing changed. */
  resize(plot: PlotSize, pixelRatio: number): void;
  draw(frame: MapFrame): void;
  dispose(): void;
}

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) {
    return null;
  }
  gl.shaderSource(shader, src);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    console.warn("[map] shader failed to compile:", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function link(
  gl: WebGL2RenderingContext,
  vertexSrc: string,
  fragmentSrc: string,
): WebGLProgram | null {
  const vert = compile(gl, gl.VERTEX_SHADER, vertexSrc);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fragmentSrc);
  if (vert === null || frag === null) {
    return null;
  }
  const program = gl.createProgram();
  if (program === null) {
    return null;
  }
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  /* Flagged for deletion now; the driver frees them when the program itself goes. */
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    console.warn("[map] program failed to link:", gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

/**
 * @param artUrl Site-root path of the map art, as authored on `MapTemplate.mapArt`.
 * @param onChange Called when a redraw is worth doing — the art decoded.
 * @param onFallback Called when this renderer can no longer carry the map and the caller should
 *   go back to the image layer. Never called synchronously: a renderer that cannot start at all
 *   returns `null` instead, so the caller never has to handle a half-built one.
 * @returns `null` when WebGL2 is unavailable or the pipeline will not build.
 */
export function createMapPlaneRenderer(
  artUrl: string,
  onChange: () => void,
  onFallback: () => void,
): MapPlaneRenderer | null {
  const canvas = document.createElement("canvas");
  canvas.className = "map-plot__gl";

  const gl = canvas.getContext("webgl2", {
    alpha: true,
    antialias: true,
    depth: false,
    stencil: false,
    /* The map is a backdrop, not the reason anyone bought a discrete GPU. */
    powerPreference: "low-power",
    preserveDrawingBuffer: false,
  });
  if (gl === null) {
    return null;
  }

  const landProgram = link(gl, LAND_VERTEX_SRC, LAND_FRAGMENT_SRC);
  const gridProgram = link(gl, LAND_VERTEX_SRC, GRID_FRAGMENT_SRC);
  const glowProgram = link(gl, GLOW_VERTEX_SRC, GLOW_FRAGMENT_SRC);
  if (landProgram === null || gridProgram === null || glowProgram === null) {
    return null;
  }

  const landMvp = gl.getUniformLocation(landProgram, "u_mvp");
  const landArt = gl.getUniformLocation(landProgram, "u_art");
  const gridMvp = gl.getUniformLocation(gridProgram, "u_mvp");
  const gridTime = gl.getUniformLocation(gridProgram, "u_time");
  const gridCells = gl.getUniformLocation(gridProgram, "u_cells");
  const glowMvp = gl.getUniformLocation(glowProgram, "u_mvp");
  const glowCenter = gl.getUniformLocation(glowProgram, "u_center");
  const glowRadius = gl.getUniformLocation(glowProgram, "u_radius");
  const glowAspect = gl.getUniformLocation(glowProgram, "u_aspect");
  const glowLevels = gl.getUniformLocation(glowProgram, "u_levels");
  const glowTime = gl.getUniformLocation(glowProgram, "u_time");

  /* One unit-square strip, shared by both layers. The vertex shader uses each UV as the
   * position too, because map space and texture space are the same square. */
  const vao = gl.createVertexArray();
  const buffer = gl.createBuffer();
  gl.bindVertexArray(vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  /* Every program declares `a_uv` first and only, so one attribute layout serves all three. */
  gl.enableVertexAttribArray(gl.getAttribLocation(landProgram, "a_uv"));
  gl.vertexAttribPointer(gl.getAttribLocation(landProgram, "a_uv"), 2, gl.FLOAT, false, 0, 0);
  gl.bindVertexArray(null);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  /* A single transparent texel, so a draw before the art decodes shows the panel's own black
   * rather than undefined memory. */
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 0]),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let artReady = false;
  let disposed = false;
  let contextLost = false;
  let bufferWidth = 0;
  let bufferHeight = 0;

  const image = new Image();
  image.decoding = "async";

  image.addEventListener("load", () => {
    if (disposed || contextLost || image.naturalWidth === 0) {
      return;
    }
    gl.bindTexture(gl.TEXTURE_2D, texture);
    /* No UNPACK_FLIP_Y_WEBGL here, deliberately. That flip exists for the usual GL convention
     * where a quad's t runs bottom-up; map space instead has v running top-down, the same
     * direction as the image's own rows, so t = 0 already lands on the art's top row. Turning
     * the flip on renders the world upside down under correctly-placed pins. */
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    /* The art is far wider than the panel (2523px into roughly 1070) and is now tilted away
     * from the camera as well, so without mipmaps the minified far edge shimmers. */
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    artReady = true;
    onChange();
  });

  image.addEventListener("error", () => {
    console.warn(`[map] could not load art ${artUrl}; falling back to the image layer`);
    onFallback();
  });

  image.src = artUrl;

  canvas.addEventListener("webglcontextlost", (event) => {
    /* Preventing the default is what would make a restore possible, but the texture and program
     * are gone regardless, so hand the panel back to the image layer rather than sit black. */
    event.preventDefault();
    contextLost = true;
    artReady = false;
    onFallback();
  });

  return {
    canvas,

    ready(): boolean {
      return artReady && !contextLost && !disposed;
    },

    resize(plot: PlotSize, pixelRatio: number): void {
      const ratio = Math.min(Math.max(pixelRatio, 1), MAX_PIXEL_RATIO);
      const width = Math.max(1, Math.round(plot.width * ratio));
      const height = Math.max(1, Math.round(plot.height * ratio));
      if (width === bufferWidth && height === bufferHeight) {
        return;
      }
      canvas.width = width;
      canvas.height = height;
      bufferWidth = width;
      bufferHeight = height;
    },

    draw(frame: MapFrame): void {
      if (disposed || contextLost || bufferWidth === 0) {
        return;
      }
      gl.viewport(0, 0, bufferWidth, bufferHeight);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (!artReady) {
        return;
      }
      gl.bindVertexArray(vao);

      /* Land: opaque, so no blend. Where the tilt leaves the quad short of the canvas edge the
       * cleared pixels stay transparent and the panel's own black shows through. */
      gl.disable(gl.BLEND);
      gl.useProgram(landProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(landArt, 0);
      gl.uniformMatrix4fv(landMvp, false, frame.land);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      /* Everything above the land is premultiplied additive, so it only ever brightens what is
       * under it and never has to be sorted back to front. */
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);

      /* Site glows sit on the land, under the lattice: what the map is *saying* belongs to the
       * ground, and the lattice reads as the instrument looking at it. */
      if (frame.signals.length > 0) {
        gl.useProgram(glowProgram);
        gl.uniformMatrix4fv(glowMvp, false, frame.land);
        gl.uniform1f(glowRadius, GLOW_RADIUS);
        gl.uniform1f(glowAspect, frame.aspect);
        gl.uniform1f(glowTime, frame.timeSeconds);
        for (const signal of frame.signals) {
          gl.uniform2f(glowCenter, signal.u, signal.v);
          gl.uniform3f(glowLevels, signal.security, signal.operation, signal.targeted);
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        }
      }

      gl.useProgram(gridProgram);
      gl.uniformMatrix4fv(gridMvp, false, frame.grid);
      gl.uniform1f(gridTime, frame.timeSeconds);
      gl.uniform2f(gridCells, GRID_CELLS[0], GRID_CELLS[1]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      gl.disable(gl.BLEND);

      gl.bindVertexArray(null);
    },

    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      image.src = "";
      gl.deleteTexture(texture);
      gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(landProgram);
      gl.deleteProgram(gridProgram);
      gl.deleteProgram(glowProgram);
      /* Without this the context lingers until GC and keeps counting against the browser's hard
       * cap on live WebGL contexts — which a run that changes maps would walk straight into. */
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      canvas.remove();
    },
  };
}

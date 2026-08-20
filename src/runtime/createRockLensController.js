const FLOWMAP_SIZE = 512;
const LENS_DPR = 2;
const FLOW_STOP_THRESHOLD = 0.003;
const POINTER_IDLE_MS = 48;

const EFFECT_INDEX = Object.freeze({
  "brandon-mercer": 0,
  "liquid-bulge": 1,
  "vortex-lens": 2,
  "pinch-tunnel": 3,
  "ripple-glass": 4,
});

const VERTEX_SHADER = `
  attribute vec2 aPosition;
  varying vec2 vUv;

  void main() {
    vUv = aPosition * 0.5 + 0.5;
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const FLOW_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uPrevious;
  uniform vec2 uMouse;
  uniform vec2 uVelocity;
  uniform float uAspect;
  uniform float uFalloff;
  uniform float uAlpha;
  uniform float uDissipation;
  uniform float uStamp;

  void main() {
    vec4 previous = texture2D(uPrevious, vUv);
    vec2 flow = (previous.rg - 0.5) * 2.0 * uDissipation;
    float life = previous.b * uDissipation;
    vec2 cursor = vUv - uMouse;
    cursor.x *= uAspect;
    float stamp = min(1.0, smoothstep(uFalloff, 0.0, length(cursor)) * uAlpha * uStamp);
    flow = mix(flow, clamp(uVelocity, -1.0, 1.0), stamp);
    life = mix(life, 1.0, stamp);
    gl_FragColor = vec4(flow * 0.5 + 0.5, life, 1.0);
  }
`;

const DISPLAY_FRAGMENT_SHADER = `
  precision highp float;
  varying vec2 vUv;
  uniform sampler2D uImage;
  uniform sampler2D uFlow;
  uniform vec2 uPointer;
  uniform float uAspect;
  uniform float uRadius;
  uniform float uStrength;
  uniform float uSoftness;
  uniform float uTwist;
  uniform float uAmount;
  uniform int uMode;

  vec2 rotatePoint(vec2 value, float angle) {
    float sine = sin(angle);
    float cosine = cos(angle);
    return mat2(cosine, -sine, sine, cosine) * value;
  }

  void main() {
    vec4 flowSample = texture2D(uFlow, vUv);
    vec2 flow = (flowSample.rg - 0.5) * 2.0;
    float flowLife = flowSample.b;
    vec2 sampleUv = vUv;

    if (uMode == 0) {
      sampleUv -= flow * uStrength * flowLife;
    } else {
      vec2 delta = vUv - uPointer;
      vec2 metric = vec2(delta.x * uAspect, delta.y);
      float distanceFromCenter = length(metric);
      float edge = clamp(1.0 - distanceFromCenter / max(uRadius, 0.001), 0.0, 1.0);
      float field = pow(smoothstep(0.0, 1.0, edge), uSoftness) * uAmount;

      if (uMode == 1) {
        sampleUv = uPointer + delta * (1.0 - uStrength * field * 0.48);
      } else if (uMode == 2) {
        sampleUv = uPointer + rotatePoint(delta, uTwist * uStrength * field);
        sampleUv -= delta * uStrength * field * 0.08;
      } else if (uMode == 3) {
        sampleUv = uPointer + rotatePoint(delta, uTwist * uStrength * field * 0.65);
        sampleUv += delta * uStrength * field * 0.62;
      } else {
        vec2 direction = metric / max(distanceFromCenter, 0.0001);
        direction.x /= uAspect;
        float waves = sin(distanceFromCenter / max(uRadius, 0.001) * 20.0 - field * 4.0);
        sampleUv -= direction * waves * uStrength * field * uRadius * 0.13;
        sampleUv = uPointer + rotatePoint(sampleUv - uPointer, uTwist * field * 0.12);
      }

      sampleUv -= flow * uStrength * flowLife * 0.18;
    }

    gl_FragColor = texture2D(uImage, clamp(sampleUv, 0.001, 0.999));
  }
`;

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || "Shader compilation failed";
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function createProgram(gl, fragmentSource) {
  const program = gl.createProgram();
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || "Shader linking failed";
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function createFlowTexture(gl) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  const neutral = new Uint8Array(FLOWMAP_SIZE * FLOWMAP_SIZE * 4);
  for (let index = 0; index < neutral.length; index += 4) {
    neutral[index] = 128;
    neutral[index + 1] = 128;
    neutral[index + 2] = 0;
    neutral[index + 3] = 255;
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    FLOWMAP_SIZE,
    FLOWMAP_SIZE,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    neutral,
  );
  return { texture, neutral };
}

function createFlowTarget(gl) {
  const { texture, neutral } = createFlowTexture(gl);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Flow-map framebuffer is incomplete");
  }
  return { framebuffer, neutral, texture };
}

function recoveryAmount(current, active, dissipation) {
  if (active) {
    return current + (1 - current) * 0.22;
  }
  const next = current * dissipation;
  return next < FLOW_STOP_THRESHOLD ? 0 : next;
}

export function createRockLensController({
  canvas,
  getConfig,
  rock,
  world,
} = {}) {
  const noOp = {
    debugState: () => ({ available: false }),
    dispose() {},
    reset() {},
  };
  if (!canvas || !rock || !world || typeof getConfig !== "function") {
    return noOp;
  }

  let gl;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: true,
      premultipliedAlpha: true,
      preserveDrawingBuffer: true,
    });
  } catch {
    return noOp;
  }
  if (!gl) {
    return noOp;
  }

  let displayProgram;
  let flowProgram;
  let flowRead;
  let flowWrite;
  try {
    displayProgram = createProgram(gl, DISPLAY_FRAGMENT_SHADER);
    flowProgram = createProgram(gl, FLOW_FRAGMENT_SHADER);
    flowRead = createFlowTarget(gl);
    flowWrite = createFlowTarget(gl);
  } catch (error) {
    canvas.dataset.lensError = String(error?.message || error);
    return noOp;
  }

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const imageTexture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, imageTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  const displayUniforms = {
    image: gl.getUniformLocation(displayProgram, "uImage"),
    flow: gl.getUniformLocation(displayProgram, "uFlow"),
    pointer: gl.getUniformLocation(displayProgram, "uPointer"),
    aspect: gl.getUniformLocation(displayProgram, "uAspect"),
    radius: gl.getUniformLocation(displayProgram, "uRadius"),
    strength: gl.getUniformLocation(displayProgram, "uStrength"),
    softness: gl.getUniformLocation(displayProgram, "uSoftness"),
    twist: gl.getUniformLocation(displayProgram, "uTwist"),
    amount: gl.getUniformLocation(displayProgram, "uAmount"),
    mode: gl.getUniformLocation(displayProgram, "uMode"),
  };
  const flowUniforms = {
    previous: gl.getUniformLocation(flowProgram, "uPrevious"),
    mouse: gl.getUniformLocation(flowProgram, "uMouse"),
    velocity: gl.getUniformLocation(flowProgram, "uVelocity"),
    aspect: gl.getUniformLocation(flowProgram, "uAspect"),
    falloff: gl.getUniformLocation(flowProgram, "uFalloff"),
    alpha: gl.getUniformLocation(flowProgram, "uAlpha"),
    dissipation: gl.getUniformLocation(flowProgram, "uDissipation"),
    stamp: gl.getUniformLocation(flowProgram, "uStamp"),
  };

  const pointer = { x: 0.5, y: 0.5 };
  const previousPointer = { x: 0.5, y: 0.5 };
  const velocity = { x: 0, y: 0 };
  const targetVelocity = { x: 0, y: 0 };
  const listenerDisposers = [];
  let amount = 0;
  let disposed = false;
  let flowEnergy = 0;
  let imageReady = false;
  let inside = false;
  let lastConfig = null;
  let lastEffect = null;
  let lastPointerAt = 0;
  let movedSinceFrame = false;
  let pressed = false;
  let renderId = null;

  function listen(target, type, handler, options) {
    target?.addEventListener(type, handler, options);
    listenerDisposers.push(() => target?.removeEventListener(type, handler, options));
  }

  function bindQuad(program) {
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    const position = gl.getAttribLocation(program, "aPosition");
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  }

  function clearFlowTarget(target) {
    gl.bindTexture(gl.TEXTURE_2D, target.texture);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      FLOWMAP_SIZE,
      FLOWMAP_SIZE,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      target.neutral,
    );
  }

  function reset() {
    amount = 0;
    flowEnergy = 0;
    velocity.x = 0;
    velocity.y = 0;
    targetVelocity.x = 0;
    targetVelocity.y = 0;
    clearFlowTarget(flowRead);
    clearFlowTarget(flowWrite);
    canvas.dataset.lensAmount = "0.000";
  }

  function uploadRockTexture() {
    if (!rock.complete || rock.naturalWidth <= 0 || rock.naturalHeight <= 0) {
      return false;
    }
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      rock,
    );
    imageReady = true;
    rock.classList.add("is-lens-rendered");
    canvas.classList.add("is-ready");
    canvas.dataset.lensSource = rock.dataset.rockImageId || "rock-03";
    reset();
    return true;
  }

  function syncCanvasGeometry() {
    const rockRect = rock.getBoundingClientRect();
    const worldRect = world.getBoundingClientRect();
    if (rockRect.width <= 0 || rockRect.height <= 0) {
      return null;
    }
    canvas.style.left = `${rockRect.left - worldRect.left + world.scrollLeft}px`;
    canvas.style.top = `${rockRect.top - worldRect.top + world.scrollTop}px`;
    canvas.style.width = `${rockRect.width}px`;
    canvas.style.height = `${rockRect.height}px`;
    const pixelWidth = Math.max(1, Math.round(rockRect.width * LENS_DPR));
    const pixelHeight = Math.max(1, Math.round(rockRect.height * LENS_DPR));
    if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
      canvas.width = pixelWidth;
      canvas.height = pixelHeight;
    }
    return rockRect;
  }

  function cleanConfig() {
    return globalThis.SisyphusRoomSettings.sanitizeRockLensConfig(
      getConfig(),
      lastConfig || globalThis.SisyphusRoomSettings.DEFAULT_ROCK_LENS_CONFIG,
    );
  }

  function pointInRock(event, rect) {
    return (
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom
    );
  }

  function recordPointer(event) {
    if (event.pointerType && event.pointerType !== "mouse" && event.isPrimary === false) {
      return;
    }
    const rect = rock.getBoundingClientRect();
    inside = pointInRock(event, rect);
    if (!inside || rect.width <= 0 || rect.height <= 0) {
      return;
    }
    const now = performance.now();
    const nextX = (event.clientX - rect.left) / rect.width;
    const nextY = 1 - (event.clientY - rect.top) / rect.height;
    previousPointer.x = pointer.x;
    previousPointer.y = pointer.y;
    pointer.x = Math.min(1, Math.max(0, nextX));
    pointer.y = Math.min(1, Math.max(0, nextY));
    if (lastPointerAt > 0) {
      const elapsedMs = Math.max(1, now - lastPointerAt);
      targetVelocity.x = (pointer.x - previousPointer.x) / elapsedMs;
      targetVelocity.y = (pointer.y - previousPointer.y) / elapsedMs;
    }
    lastPointerAt = now;
    movedSinceFrame = true;
  }

  function handlePointerDown(event) {
    if (event.button !== 0 || !pointInRock(event, rock.getBoundingClientRect())) {
      return;
    }
    pressed = true;
    recordPointer(event);
  }

  function handlePointerUp() {
    pressed = false;
  }

  function updateFlow(config, rect) {
    const shouldStamp = movedSinceFrame && inside &&
      (config.activation === "hover" || pressed);
    const hasFreshVelocity = performance.now() - lastPointerAt <= POINTER_IDLE_MS;
    const lerp = Math.min(
      1,
      hasFreshVelocity && Math.hypot(targetVelocity.x, targetVelocity.y) > 0
        ? config.trail
        : Math.min(0.1, config.trail),
    );
    velocity.x += (targetVelocity.x - velocity.x) * lerp;
    velocity.y += (targetVelocity.y - velocity.y) * lerp;
    if (!hasFreshVelocity) {
      targetVelocity.x = 0;
      targetVelocity.y = 0;
    }

    if (!shouldStamp && flowEnergy <= 0) {
      movedSinceFrame = false;
      return;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, flowWrite.framebuffer);
    gl.viewport(0, 0, FLOWMAP_SIZE, FLOWMAP_SIZE);
    gl.useProgram(flowProgram);
    bindQuad(flowProgram);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, flowRead.texture);
    gl.uniform1i(flowUniforms.previous, 1);
    gl.uniform2f(flowUniforms.mouse, pointer.x, pointer.y);
    gl.uniform2f(
      flowUniforms.velocity,
      velocity.x * 18,
      velocity.y * 18,
    );
    gl.uniform1f(flowUniforms.aspect, rect.width / rect.height);
    gl.uniform1f(flowUniforms.falloff, config.radius);
    gl.uniform1f(flowUniforms.alpha, config.softness);
    gl.uniform1f(flowUniforms.dissipation, config.dissipation);
    gl.uniform1f(flowUniforms.stamp, shouldStamp ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    [flowRead, flowWrite] = [flowWrite, flowRead];

    flowEnergy = shouldStamp ? 1 : flowEnergy * config.dissipation;
    if (flowEnergy < FLOW_STOP_THRESHOLD) {
      flowEnergy = 0;
      clearFlowTarget(flowRead);
      clearFlowTarget(flowWrite);
    }
    movedSinceFrame = false;
  }

  function draw(config, rect) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(displayProgram);
    bindQuad(displayProgram);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, imageTexture);
    gl.uniform1i(displayUniforms.image, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, flowRead.texture);
    gl.uniform1i(displayUniforms.flow, 1);
    gl.uniform2f(displayUniforms.pointer, pointer.x, pointer.y);
    gl.uniform1f(displayUniforms.aspect, rect.width / rect.height);
    gl.uniform1f(displayUniforms.radius, config.radius);
    gl.uniform1f(displayUniforms.strength, config.strength);
    gl.uniform1f(displayUniforms.softness, config.softness);
    gl.uniform1f(displayUniforms.twist, config.twistDegrees * Math.PI / 180);
    gl.uniform1f(displayUniforms.amount, amount);
    gl.uniform1i(displayUniforms.mode, EFFECT_INDEX[config.effect] ?? 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function render() {
    if (disposed) {
      return;
    }
    const rect = syncCanvasGeometry();
    if (rect && imageReady) {
      const config = cleanConfig();
      if (lastEffect !== null && config.effect !== lastEffect) {
        reset();
      }
      lastConfig = config;
      lastEffect = config.effect;
      const analyticActive = inside &&
        (config.activation === "hover" || pressed);
      amount = recoveryAmount(amount, analyticActive, config.dissipation);
      updateFlow(config, rect);
      draw(config, rect);
      canvas.dataset.lensAmount = amount.toFixed(3);
      canvas.dataset.lensEffect = config.effect;
      canvas.dataset.flowEnergy = flowEnergy.toFixed(3);
    }
    renderId = window.requestAnimationFrame(render);
  }

  listen(rock, "load", uploadRockTexture);
  listen(window, "pointermove", recordPointer, { passive: true });
  listen(window, "pointerdown", handlePointerDown, { passive: true });
  listen(window, "pointerup", handlePointerUp, { passive: true });
  listen(window, "pointercancel", handlePointerUp, { passive: true });
  listen(window, "blur", () => {
    inside = false;
    pressed = false;
  });

  uploadRockTexture();
  renderId = window.requestAnimationFrame(render);

  return {
    debugState() {
      return {
        amount,
        available: true,
        config: lastConfig ? { ...lastConfig } : cleanConfig(),
        flowEnergy,
        flowmapSize: FLOWMAP_SIZE,
        imageReady,
        inside,
        pressed,
      };
    },
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      if (renderId !== null) {
        window.cancelAnimationFrame(renderId);
      }
      listenerDisposers.splice(0).forEach((dispose) => dispose());
      rock.classList.remove("is-lens-rendered");
      canvas.classList.remove("is-ready");
      gl.deleteBuffer(quad);
      gl.deleteTexture(imageTexture);
      [flowRead, flowWrite].forEach((target) => {
        gl.deleteFramebuffer(target.framebuffer);
        gl.deleteTexture(target.texture);
      });
      gl.deleteProgram(displayProgram);
      gl.deleteProgram(flowProgram);
    },
    reset,
  };
}

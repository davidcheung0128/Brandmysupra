import * as THREE from "three";
import { panelBounds, panelMaskPoints, slotRect } from "./surface.js";
import { modelRootFromObject } from "./placement.js";

const MARGIN = 0.08;
const TEXTURE_PX_PER_METRE = 420;

/**
 * Canvas in panel (u, v) space, sampled per fragment from the mesh's own position, so a
 * section boundary hugs the car exactly however the logo decal is oriented or curved.
 */
function panelCanvas(panel, draw) {
  const { minU, maxU, minV, maxV } = panelBounds(panel);
  const frame = { minU: minU - MARGIN, minV: minV - MARGIN, width: maxU - minU + MARGIN * 2, height: maxV - minV + MARGIN * 2 };
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(frame.width * TEXTURE_PX_PER_METRE);
  canvas.height = Math.round(frame.height * TEXTURE_PX_PER_METRE);
  const context = canvas.getContext("2d");
  const toXY = ([u, v]) => [((u - frame.minU) / frame.width) * canvas.width, (1 - (v - frame.minV) / frame.height) * canvas.height];
  const path = (loop) => {
    context.beginPath();
    loop.forEach((point, index) => context[index ? "lineTo" : "moveTo"](...toXY(point)));
    context.closePath();
  };
  draw(context, { path, toXY, pxPerMetre: TEXTURE_PX_PER_METRE });
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.anisotropy = 8;
  return { texture, frame };
}

const slotLoop = (slot) => {
  const { minU, maxU, minV, maxV } = slotRect(slot);
  return [[minU, minV], [maxU, minV], [maxU, maxV], [minU, maxV]];
};

/** Alpha mask: the selected slots, cut to the panel outline. Entire panel = the whole outline. */
export function regionTexture(panel, slots, entirePanel) {
  return panelCanvas(panel, (context, { path }) => {
    context.fillStyle = "#fff";
    if (entirePanel || !slots.length) {
      path(panelMaskPoints(panel));
      context.fill();
      return;
    }
    slots.forEach((slot) => {
      path(slotLoop(slot));
      context.fill();
    });
    context.globalCompositeOperation = "destination-in";
    path(panelMaskPoints(panel));
    context.fill();
  });
}

/** Thin slot boundaries, the panel outline, slot numbers, and a tint on the selected slots. */
export function outlineTexture(panel, selectedIds) {
  return panelCanvas(panel, (context, { path, toXY, pxPerMetre }) => {
    context.save();
    path(panelMaskPoints(panel));
    context.clip();
    panel.slots.forEach((slot) => {
      if (!selectedIds.includes(slot.id)) return;
      path(slotLoop(slot));
      context.fillStyle = "rgba(255, 58, 38, 0.2)";
      context.fill();
    });
    context.strokeStyle = "rgba(255, 255, 255, 0.85)";
    context.lineWidth = 0.008 * pxPerMetre;
    panel.slots.forEach((slot) => {
      path(slotLoop(slot));
      context.stroke();
    });
    context.restore();
    context.strokeStyle = "rgba(255, 255, 255, 0.95)";
    context.lineWidth = 0.014 * pxPerMetre;
    context.lineJoin = "round";
    path(panelMaskPoints(panel));
    context.stroke();
    context.fillStyle = "rgba(255, 255, 255, 0.95)";
    context.font = `600 ${0.13 * pxPerMetre}px sans-serif`;
    context.textAlign = "center";
    context.textBaseline = "middle";
    panel.slots.forEach((slot, index) => context.fillText(String(index + 1), ...toXY([slot.u, slot.v])));
  });
}

/**
 * Drive `material` from panel space: `clip` multiplies alpha by the region mask (logo cut-off),
 * `draw` paints the texture itself (section outlines). Only surfaces facing the panel count, so
 * the far side of the car never picks up a section. In `clip` mode, `projection` (mesh-local decal
 * direction) also fades the logo where the surface turns away, so it never smears. Vertices are read in mesh-local space and
 * carried into car-group space every draw, so it works before the model is attached and follows
 * the car as it turns.
 */
export function bindPanelSpace(material, panel, { texture, frame }, mode, projection = new THREE.Vector3()) {
  const uniforms = {
    uSecU: { value: new THREE.Vector4() },
    uSecV: { value: new THREE.Vector4() },
    uSecN: { value: new THREE.Vector3() },
    uSecP: { value: projection },
    uSecFrame: { value: new THREE.Vector4(frame.minU, frame.minV, frame.width, frame.height) },
    uSecMap: { value: texture },
  };
  const origin = new THREE.Vector3(...panel.origin);
  const uDir = new THREE.Vector3(...panel.uAxis).normalize();
  const vDir = new THREE.Vector3(...panel.vAxis).normalize();
  const nDir = new THREE.Vector3(...panel.normal).normalize();
  const toRoot = new THREE.Matrix4();
  const linear = new THREE.Matrix3();
  const linearT = new THREE.Matrix3();
  const translation = new THREE.Vector3();
  const local = new THREE.Vector3();
  const axis = (target, dir) => {
    local.copy(dir).applyMatrix3(linearT);
    target.set(local.x, local.y, local.z, translation.dot(dir));
  };

  material.onBeforeRender = (renderer, scene, camera, geometry, object) => {
    const root = modelRootFromObject(object);
    root.updateWorldMatrix(true, false);
    toRoot.copy(root.matrixWorld).invert().multiply(object.matrixWorld);
    linear.setFromMatrix4(toRoot);
    linearT.copy(linear).transpose();
    translation.setFromMatrixPosition(toRoot).sub(origin);
    axis(uniforms.uSecU.value, uDir);
    axis(uniforms.uSecV.value, vDir);
    uniforms.uSecN.value.copy(nDir).applyMatrix3(linear.invert()).normalize();
    material.uniformsNeedUpdate = true;
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
uniform vec4 uSecU; uniform vec4 uSecV; uniform vec3 uSecN; uniform vec3 uSecP;
varying vec2 vSecUV; varying float vSecN; varying float vSecP;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vSecUV = vec2(dot(position, uSecU.xyz) + uSecU.w, dot(position, uSecV.xyz) + uSecV.w);
vSecN = dot(normal, uSecN);
vSecP = abs(dot(normal, uSecP));`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform vec4 uSecFrame; uniform sampler2D uSecMap;
varying vec2 vSecUV; varying float vSecN; varying float vSecP;`)
      .replace("#include <alphatest_fragment>", `
vec2 secST = (vSecUV - uSecFrame.xy) / uSecFrame.zw;
float secFacing = smoothstep(0.2, 0.5, vSecN)
  * step(0.0, secST.x) * step(secST.x, 1.0) * step(0.0, secST.y) * step(secST.y, 1.0);
vec4 secTexel = texture2D(uSecMap, secST);
${mode === "clip" ? "diffuseColor.a *= secTexel.a * secFacing * smoothstep(0.3, 0.6, vSecP);" : "diffuseColor = vec4(secTexel.rgb, secTexel.a * secFacing);"}
#include <alphatest_fragment>`);
  };
  material.customProgramCacheKey = () => `panel-space-${mode}`;
  material.needsUpdate = true;
  return material;
}

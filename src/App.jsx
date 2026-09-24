import { createPortal, useLoader, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import React, { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { ALL_SLOTS, INITIAL_BIDS, PANELS, SLOT_MAP } from "./slots.js";
import { isCompanyEmail, money, nextBidForSlots } from "./domain.js";
import {
  clampToPlacementRegion,
  isEntirePanelSelected,
  panelBounds,
  panelMaskPoints,
  placementRegionLoops,
  pointInPlacementRegion,
} from "./surface.js";
import {
  buildLocalDecalGeometry,
  coverageRatio,
  localProjectorFromPlacement,
  orientationFromNormal,
  panelFrameNormal,
  panelFramePoint,
  placementFromHit,
  projectOntoPaintMeshes,
  updatePlacement,
  uvScaleFromHit,
  worldToModelPoint,
  worldToPanelUV,
  modelRootFromObject,
} from "./placement.js";
import {
  bakePlacementToAtlas,
  canvasToObjectUrl,
  hullHandlePoints,
  logoWorldSize,
  prepareLogo,
} from "./logo.js";
import CinemaCanvas from "./CinemaCanvas.jsx";
import CustomCursor from "./motion/CustomCursor.jsx";
import MagneticButton from "./motion/MagneticButton.jsx";
import RevealText from "./motion/RevealText.jsx";
import { cinemaRefs, panelTourFromProgress, progressForPanel, sceneWeights } from "./motion/cinemaState.js";
import { useSmoothScroll } from "./motion/useSmoothScroll.js";

const DEFAULT_SCALE = 0.82;

function slotBounds(selected) {
  const slots = selected.map((id) => SLOT_MAP[id]);
  const panel = PANELS[slots[0].panel];
  const minU = Math.min(...slots.map((slot) => slot.u - slot.width / 2));
  const maxU = Math.max(...slots.map((slot) => slot.u + slot.width / 2));
  const minV = Math.min(...slots.map((slot) => slot.v - slot.height / 2));
  const maxV = Math.max(...slots.map((slot) => slot.v + slot.height / 2));
  return {
    panel,
    minU,
    maxU,
    minV,
    maxV,
    centerU: (minU + maxU) / 2,
    centerV: (minV + maxV) / 2,
    width: maxU - minU,
    height: maxV - minV,
  };
}

/** Alpha mask in decal space — white inside chosen region, transparent outside (logo cut-off). */
function placementRegionMaskTexture(panel, slots, entirePanel, centerU, centerV, width, height, rotation = 0) {
  const size = 512;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, size, size);
  context.fillStyle = "#ffffff";
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const toXY = (u, v) => {
    const dx = u - centerU;
    const dy = v - centerV;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    return [(localX / width + 0.5) * size, (0.5 - localY / height) * size];
  };
  const fillLoop = (loop) => {
    context.beginPath();
    loop.forEach(([u, v], index) => {
      const [x, y] = toXY(u, v);
      if (index) context.lineTo(x, y);
      else context.moveTo(x, y);
    });
    context.closePath();
    context.fill();
  };

  const loops = placementRegionLoops(panel, slots, { entirePanel });
  loops.forEach(fillLoop);

  if (!entirePanel && slots.length) {
    context.globalCompositeOperation = "destination-in";
    fillLoop(panelMaskPoints(panel));
    context.globalCompositeOperation = "source-over";
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

function nearestPanelKey(point) {
  let best = null;
  let bestScore = Infinity;
  for (const [key, panel] of Object.entries(PANELS)) {
    const [u, v] = worldToPanelUV(panel, point);
    const bounds = panelBounds(panel);
    const cu = THREE.MathUtils.clamp(u, bounds.minU, bounds.maxU);
    const cv = THREE.MathUtils.clamp(v, bounds.minV, bounds.maxV);
    const score = (u - cu) ** 2 + (v - cv) ** 2;
    if (score < bestScore) {
      bestScore = score;
      best = key;
    }
  }
  return best;
}

function selectedSlots(selected) {
  return selected.map((id) => SLOT_MAP[id]).filter(Boolean);
}

function hitOnSelectedPanel(hit, selected) {
  if (!selected.length) return false;
  const panel = PANELS[SLOT_MAP[selected[0]].panel];
  const modelPoint = worldToModelPoint(hit.object, hit.point);
  const [u, v] = worldToPanelUV(panel, modelPoint);
  const slots = selectedSlots(selected);
  const entirePanel = isEntirePanelSelected(panel, selected);
  return pointInPlacementRegion(panel, slots, u, v, { entirePanel, pad: entirePanel ? 0.35 : 0.18 });
}

function projectUvOntoPaint(panel, paintMeshes, u, v) {
  const guess = panelFramePoint(panel, u, v);
  const guessNormal = panelFrameNormal(panel);
  return projectOntoPaintMeshes(paintMeshes, guess, guessNormal);
}

/** Sample a closed UV polyline onto paint meshes as mesh-local points (slightly lifted). */
function sampleUvLoopOnPaint(panel, paintMeshes, uvLoop, samplesPerEdge = 10) {
  const panelNormal = panelFrameNormal(panel);
  const byMesh = new Map();

  const pushPoint = (mesh, worldPoint, faceNormal) => {
    mesh.updateWorldMatrix(true, false);
    const local = mesh.worldToLocal(worldPoint.clone());
    const localN = faceNormal
      ? faceNormal.clone().normalize()
      : panelNormal.clone().transformDirection(new THREE.Matrix4().copy(mesh.matrixWorld).invert()).normalize();
    local.addScaledVector(localN, 0.006);
    if (!byMesh.has(mesh)) byMesh.set(mesh, []);
    byMesh.get(mesh).push(local);
  };

  for (let edge = 0; edge < uvLoop.length; edge += 1) {
    const [u0, v0] = uvLoop[edge];
    const [u1, v1] = uvLoop[(edge + 1) % uvLoop.length];
    for (let i = 0; i < samplesPerEdge; i += 1) {
      const t = i / samplesPerEdge;
      const u = u0 + (u1 - u0) * t;
      const v = v0 + (v1 - v0) * t;
      const guess = panelFramePoint(panel, u, v);
      const hit = projectOntoPaintMeshes(paintMeshes, guess, panelNormal);
      if (hit) {
        pushPoint(hit.object, hit.point, hit.face?.normal);
      } else if (paintMeshes[0]) {
        const root = modelRootFromObject(paintMeshes[0]);
        root.updateWorldMatrix(true, false);
        pushPoint(paintMeshes[0], root.localToWorld(guess.clone()), null);
      }
    }
  }

  for (const [, points] of byMesh) {
    if (points.length) points.push(points[0].clone());
  }
  return byMesh;
}

function SlotBoundaryLines({ panelKey, selected, paintMeshes, logoVisible }) {
  const panel = PANELS[panelKey];
  const selectedKey = selected.join("|");
  const entirePanel = panel ? isEntirePanelSelected(panel, selected) : false;

  const outlines = useMemo(() => {
    if (!paintMeshes.length || !panel || !selected.length) return [];
    const slots = selectedSlots(selected);
    const loops = placementRegionLoops(panel, slots, { entirePanel });
    const entries = [];

    loops.forEach((loop, loopIndex) => {
      const byMesh = sampleUvLoopOnPaint(panel, paintMeshes, loop, 12);
      for (const [mesh, points] of byMesh) {
        if (points.length < 2) continue;
        const positions = new Float32Array(points.length * 3);
        points.forEach((point, index) => {
          positions[index * 3] = point.x;
          positions[index * 3 + 1] = point.y;
          positions[index * 3 + 2] = point.z;
        });
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        entries.push({
          id: `${loopIndex}-${mesh.uuid}`,
          mesh,
          geometry,
        });
      }
    });

    return entries;
  }, [paintMeshes, panelKey, selectedKey, entirePanel]);

  useEffect(() => () => {
    outlines.forEach((entry) => entry.geometry.dispose());
  }, [outlines]);

  if (!outlines.length) return null;

  const opacity = logoVisible ? 0.7 : 0.95;

  return outlines.map(({ id, mesh, geometry }) => createPortal(
    <line key={id} geometry={geometry} renderOrder={5} raycast={() => null}>
      <lineBasicMaterial
        color="#f4f4f1"
        transparent
        opacity={opacity}
        depthWrite={false}
        depthTest
        toneMapped={false}
      />
    </line>,
    mesh,
  ));
}

function PanelTint({ selected, paintMeshes, logoVisible }) {
  const { panel, minU, maxU, minV, maxV, centerU, centerV } = slotBounds(selected);
  const guess = panelFramePoint(panel, centerU, centerV);
  const guessNormal = panelFrameNormal(panel);
  const size = new THREE.Vector3((maxU - minU) * 0.98, (maxV - minV) * 0.98, 0.55);

  const portals = useMemo(() => {
    if (!paintMeshes.length) return [];
    const hit = projectOntoPaintMeshes(paintMeshes, guess, guessNormal);
    const entries = [];
    for (const mesh of paintMeshes) {
      mesh.updateWorldMatrix(true, false);
      let localPosition;
      let orientation;
      if (hit && mesh.uuid === hit.object.uuid) {
        const projector = localProjectorFromPlacement(placementFromHit({
          panelMesh: panel.label,
          hit,
          selectedSlotIds: selected,
        }), mesh);
        localPosition = projector.position;
        orientation = projector.orientation;
      } else if (!hit) {
        const root = modelRootFromObject(mesh);
        root.updateWorldMatrix(true, false);
        const worldGuess = root.localToWorld(guess.clone());
        localPosition = mesh.worldToLocal(worldGuess);
        const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
        const localN = guessNormal.clone().transformDirection(root.matrixWorld).transformDirection(inv).normalize();
        orientation = orientationFromNormal(localN.toArray(), 0);
      } else {
        continue;
      }
      const geometry = buildLocalDecalGeometry(mesh, localPosition, orientation, size);
      if (geometry.attributes.position.count === 0) {
        geometry.dispose();
        continue;
      }
      entries.push({ mesh, geometry });
    }
    return entries;
  }, [paintMeshes, selected.join("|")]);

  useEffect(() => () => portals.forEach((entry) => entry.geometry.dispose()), [portals]);

  if (logoVisible) return null;
  return portals.map(({ mesh, geometry }, index) => createPortal(
    <mesh key={index} geometry={geometry} renderOrder={3} raycast={() => null}>
      <meshStandardMaterial
        color="#ef3e2f"
        transparent
        opacity={0.26}
        roughness={0.35}
        depthWrite={false}
        polygonOffset
        polygonOffsetFactor={-4}
      />
    </mesh>,
    mesh,
  ));
}

function SurfaceDecal({ url, placement, aspect, maxWidth, maxHeight, paintMeshes, maskPanel, selectedIds }) {
  const texture = useLoader(THREE.TextureLoader, url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const sizeInfo = logoWorldSize(aspect, maxWidth, maxHeight, placement.scale);
  const depth = Math.max(0.28, Math.min(0.7, Math.max(sizeInfo.width, sizeInfo.height) * 0.55));
  const size = new THREE.Vector3(sizeInfo.width, sizeInfo.height, depth);
  const slots = selectedSlots(selectedIds);
  const entirePanel = isEntirePanelSelected(maskPanel, selectedIds);

  const targetMeshes = useMemo(() => {
    if (!placement.meshUuid) return paintMeshes;
    const match = paintMeshes.filter((mesh) => mesh.uuid === placement.meshUuid);
    return match.length ? match : paintMeshes;
  }, [paintMeshes, placement.meshUuid]);

  const portals = useMemo(() => {
    return targetMeshes.map((mesh) => {
      const { position, orientation } = localProjectorFromPlacement(placement, mesh);
      const geometry = buildLocalDecalGeometry(mesh, position, orientation, size);
      return { mesh, geometry, position };
    }).filter((entry) => entry.geometry.attributes.position.count > 0);
  }, [
    targetMeshes,
    placement.localPoint?.join(),
    placement.localNormal?.join(),
    placement.surfacePoint.join(),
    placement.surfaceNormal.join(),
    placement.rotation,
    size.x,
    size.y,
    size.z,
  ]);

  const modelPoint = useMemo(() => {
    if (!portals[0]) return new THREE.Vector3(...placement.surfacePoint);
    return worldToModelPoint(portals[0].mesh, portals[0].mesh.localToWorld(portals[0].position.clone()));
  }, [portals, placement.surfacePoint.join()]);

  const [centerU, centerV] = worldToPanelUV(maskPanel, modelPoint);
  const mask = useMemo(
    () => placementRegionMaskTexture(
      maskPanel,
      slots,
      entirePanel,
      centerU,
      centerV,
      Math.max(size.x, 0.2),
      Math.max(size.y, 0.2),
      placement.rotation,
    ),
    [maskPanel, selectedIds.join("|"), entirePanel, centerU, centerV, size.x, size.y, placement.rotation],
  );

  useEffect(() => () => portals.forEach((entry) => entry.geometry.dispose()), [portals]);
  useEffect(() => () => mask.dispose(), [mask]);

  return portals.map(({ mesh, geometry }, index) => createPortal(
    <mesh key={`${mesh.uuid}-${index}`} geometry={geometry} renderOrder={4} raycast={() => null}>
      <meshBasicMaterial
        map={texture}
        alphaMap={mask}
        transparent
        alphaTest={0.04}
        toneMapped={false}
        depthWrite={false}
        depthTest
        polygonOffset
        polygonOffsetFactor={-8}
        polygonOffsetUnits={-8}
      />
    </mesh>,
    mesh,
  ));
}

function ContourHandles({ placement, aspect, maxWidth, maxHeight, hull, paintMeshes }) {
  const sizeInfo = logoWorldSize(aspect, maxWidth, maxHeight, placement.scale);
  const mesh = paintMeshes.find((entry) => entry.uuid === placement.meshUuid) || paintMeshes[0];
  if (!mesh) return null;

  const { position, orientation } = localProjectorFromPlacement(placement, mesh);
  const matrix = new THREE.Matrix4().makeRotationFromEuler(orientation);
  const normal = placement.localNormal
    ? new THREE.Vector3(...placement.localNormal).normalize()
    : new THREE.Vector3(0, 0, 1);
  const handles = hullHandlePoints(hull).map(([hx, hy]) => {
    const local = new THREE.Vector3((hx - 0.5) * sizeInfo.width, (0.5 - hy) * sizeInfo.height, 0.02);
    return position.clone().add(local.applyMatrix4(matrix)).addScaledVector(normal, 0.01);
  });

  return createPortal(
    <>
      {handles.map((point, index) => (
        <mesh key={index} position={point} renderOrder={6} raycast={() => null}>
          <sphereGeometry args={[0.028, 12, 12]} />
          <meshStandardMaterial color="#f4f4f1" emissive="#ef3e2f" emissiveIntensity={0.35} metalness={0.4} roughness={0.35} />
        </mesh>
      ))}
    </>,
    mesh,
  );
}

function BodyPointerLayer({
  paintMeshes,
  selected,
  placement,
  setPlacement,
  setDragging,
  checkpoint,
  locked,
  onPanelPick,
  hasLogo,
  enabled = true,
}) {
  const dragging = useRef(false);
  const lastRebuild = useRef(0);
  const { camera, gl } = useThree();
  const selectedRef = useRef(selected);
  const placementRef = useRef(placement);
  const lockedRef = useRef(locked);
  const hasLogoRef = useRef(hasLogo);
  const enabledRef = useRef(enabled);
  selectedRef.current = selected;
  placementRef.current = placement;
  lockedRef.current = locked;
  hasLogoRef.current = hasLogo;
  enabledRef.current = enabled;

  useEffect(() => {
    const element = gl.domElement;
    const pointer = new THREE.Vector2();
    const raycaster = new THREE.Raycaster();

    const hitPaint = (clientX, clientY) => {
      const rect = element.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      paintMeshes.forEach((mesh) => mesh.updateWorldMatrix(true, false));
      return raycaster.intersectObjects(paintMeshes, false)[0];
    };

    const applyHit = (hit, force) => {
      const currentSelected = selectedRef.current;
      const currentPlacement = placementRef.current;
      if (!hit || !currentSelected.length) return;
      if (!hitOnSelectedPanel(hit, currentSelected)) return;
      const panelKey = SLOT_MAP[currentSelected[0]].panel;
      const panel = PANELS[panelKey];
      const slots = selectedSlots(currentSelected);
      const entirePanel = isEntirePanelSelected(panel, currentSelected);
      const modelPoint = worldToModelPoint(hit.object, hit.point);
      const [u, v] = worldToPanelUV(panel, modelPoint);
      const [cu, cv] = clampToPlacementRegion(panel, slots, u, v, { entirePanel });
      const drift = Math.hypot(u - cu, v - cv);

      let useHit = hit;
      if (drift > 0.001) {
        const projected = projectUvOntoPaint(panel, paintMeshes, cu, cv);
        if (!projected) {
          if (drift > 0.08) return;
        } else {
          useHit = projected;
        }
      }

      const next = placementFromHit({
        panelMesh: panelKey,
        hit: useHit,
        rotation: currentPlacement?.rotation ?? 0,
        scale: currentPlacement?.scale ?? DEFAULT_SCALE,
        selectedSlotIds: currentSelected,
        logoAssetId: currentPlacement?.logoAssetId ?? null,
      });

      const now = performance.now();
      if (!force && now - lastRebuild.current < 40) {
        setPlacement((current) => updatePlacement(current || next, {
          surfacePoint: next.surfacePoint,
          surfaceNormal: next.surfaceNormal,
          localPoint: next.localPoint,
          localNormal: next.localNormal,
          uvCenter: next.uvCenter,
          meshUuid: next.meshUuid,
        }));
        return;
      }
      lastRebuild.current = now;
      setPlacement((current) => updatePlacement(current || next, next));
    };

    const onPointerDown = (event) => {
      if (!enabledRef.current) return;
      if (event.button === 2 || event.buttons === 2) return;
      const hit = hitPaint(event.clientX, event.clientY);
      if (!hit) return;
      if (!hasLogoRef.current) {
        const modelPoint = worldToModelPoint(hit.object, hit.point);
        const panelKey = nearestPanelKey(modelPoint);
        if (panelKey) onPanelPick(panelKey);
        return;
      }
      if (lockedRef.current) return;
      if (!hitOnSelectedPanel(hit, selectedRef.current)) return;
      event.preventDefault();
      checkpoint();
      dragging.current = true;
      setDragging(true);
      element.style.cursor = "grabbing";
      element.setPointerCapture?.(event.pointerId);
      applyHit(hit, true);
    };

    const onPointerMove = (event) => {
      if (!enabledRef.current) return;
      if (event.buttons === 2) return;
      if (!dragging.current) {
        const hover = hitPaint(event.clientX, event.clientY);
        element.style.cursor = hover
          ? (hasLogoRef.current && !lockedRef.current ? "grab" : "pointer")
          : "";
        return;
      }
      event.preventDefault();
      applyHit(hitPaint(event.clientX, event.clientY), false);
    };

    const endDrag = (event) => {
      if (!dragging.current) return;
      applyHit(hitPaint(event.clientX, event.clientY), true);
      dragging.current = false;
      setDragging(false);
      element.style.cursor = "";
      element.releasePointerCapture?.(event.pointerId);
    };

    const blockMenu = (event) => event.preventDefault();

    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", endDrag);
    element.addEventListener("pointercancel", endDrag);
    element.addEventListener("contextmenu", blockMenu);
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", endDrag);
      element.removeEventListener("pointercancel", endDrag);
      element.removeEventListener("contextmenu", blockMenu);
    };
  }, [camera, checkpoint, gl, onPanelPick, paintMeshes, setDragging, setPlacement]);

  return null;
}

function SupraModel({
  logoUrl,
  logoMeta,
  selected,
  placement,
  setPlacement,
  setDragging,
  checkpoint,
  locked,
  baked,
  onPanelPick,
  paintApiRef,
  interactive = true,
}) {
  const { scene } = useGLTF("/models/supra.optimized.glb?v=3");
  const { model, paintMeshes, paintMaterials } = useMemo(() => {
    const clone = scene.clone(true);
    const bodyMeshes = [];
    const materials = [];
    const tuneMaterial = (source) => {
      const materialName = source.name;
      let material = source.clone();
      material.envMapIntensity = 1.25;
      if (materialName === "Supra_body_paint") {
        material = new THREE.MeshPhysicalMaterial({
          name: materialName,
          color: "#deded9",
          metalness: 0.18,
          roughness: 0.17,
          clearcoat: 1,
          clearcoatRoughness: 0.06,
          ior: 1.5,
          specularIntensity: 0.95,
          envMapIntensity: 1.55,
        });
        materials.push(material);
      } else if (["Chrome", "GrayChrome", "Metallic", "BrakeDisc"].includes(materialName)) {
        material.metalness = 0.88;
        material.roughness = materialName === "BrakeDisc" ? 0.32 : 0.18;
      } else if (materialName === "BlackGloss") {
        material.metalness = 0.35;
        material.roughness = 0.12;
      } else if (materialName === "MKV.Tire") {
        material.color.set("#11110f");
        material.roughness = 0.78;
      } else if (["Window", "HeadlightGlass"].includes(materialName)) {
        material.transparent = true;
        material.opacity = materialName === "Window" ? 0.42 : 0.58;
        material.roughness = 0.1;
        material.depthWrite = false;
      } else if (["BrakeLight", "Taillight", "Runninglight"].includes(materialName)) {
        material.emissive.set(materialName === "Runninglight" ? "#fff8e8" : "#7d0500");
        material.emissiveIntensity = materialName === "Runninglight" ? 0.7 : 0.35;
      }
      return material;
    };

    clone.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
      const sources = Array.isArray(object.material) ? object.material : [object.material];
      if (sources.some((material) => material.name === "Supra_body_paint")) bodyMeshes.push(object);
      const next = sources.map(tuneMaterial);
      object.material = Array.isArray(object.material) ? next : next[0];
    });

    let box = new THREE.Box3().setFromObject(clone);
    const rawSize = box.getSize(new THREE.Vector3());
    if (rawSize.z > rawSize.x) clone.rotation.y = Math.PI / 2;
    clone.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    clone.scale.setScalar(6.35 / Math.max(size.x, size.z));
    clone.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(clone);
    const center = box.getCenter(new THREE.Vector3());
    clone.position.set(-center.x, 0.05 - box.min.y, -center.z);
    clone.updateMatrixWorld(true);
    return { model: clone, paintMeshes: bodyMeshes, paintMaterials: materials };
  }, [scene]);

  useEffect(() => {
    paintApiRef.current = { paintMeshes, paintMaterials };
  }, [paintApiRef, paintMeshes, paintMaterials]);

  useEffect(() => {
    if (!baked?.texture) {
      paintMaterials.forEach((material) => {
        if (material.map) {
          material.map.dispose();
          material.map = null;
          material.color.set("#deded9");
          material.needsUpdate = true;
        }
      });
      return;
    }
    const target = paintMeshes.find((mesh) => mesh.uuid === baked.meshUuid);
    const material = target
      ? (Array.isArray(target.material) ? target.material.find((entry) => entry.name === "Supra_body_paint") : target.material)
      : paintMaterials[0];
    if (!material) return;
    if (material.map) material.map.dispose();
    material.map = baked.texture;
    material.map.colorSpace = THREE.SRGBColorSpace;
    material.map.flipY = false;
    material.map.needsUpdate = true;
    material.color.set("#ffffff");
    material.needsUpdate = true;
  }, [baked, paintMaterials, paintMeshes]);

  const panel = selected.length ? PANELS[SLOT_MAP[selected[0]].panel] : null;
  const bounds = selected.length ? slotBounds(selected) : null;
  const coverage = panel ? coverageRatio(selected, panel) : 1;
  const maxWidth = bounds ? bounds.width * coverage : 1;
  const maxHeight = bounds ? bounds.height * coverage : 1;
  const showDecal = logoUrl && placement && selected.length > 0 && !baked;

  return (
    <>
      <primitive object={model} />
      {selected.length > 0 && (
        <SlotBoundaryLines
          panelKey={SLOT_MAP[selected[0]].panel}
          selected={selected}
          paintMeshes={paintMeshes}
          logoVisible={Boolean(logoUrl) || Boolean(baked)}
        />
      )}
      {selected.length > 0 && <PanelTint selected={selected} paintMeshes={paintMeshes} logoVisible={Boolean(logoUrl) || Boolean(baked)} />}
      {showDecal && (
        <>
          <SurfaceDecal
            url={logoUrl}
            placement={placement}
            aspect={logoMeta?.aspect || 1}
            maxWidth={maxWidth}
            maxHeight={maxHeight}
            paintMeshes={paintMeshes}
            maskPanel={panel}
            selectedIds={selected}
          />
          {!locked && (
            <ContourHandles
              placement={placement}
              aspect={logoMeta?.aspect || 1}
              maxWidth={maxWidth}
              maxHeight={maxHeight}
              hull={logoMeta?.hull}
              paintMeshes={paintMeshes}
            />
          )}
        </>
      )}
      <BodyPointerLayer
        paintMeshes={paintMeshes}
        selected={selected}
        placement={placement}
        setPlacement={setPlacement}
        setDragging={setDragging}
        checkpoint={checkpoint}
        locked={locked || Boolean(baked)}
        onPanelPick={onPanelPick}
        hasLogo={Boolean(logoUrl)}
        enabled={interactive}
      />
    </>
  );
}

function BidModal({ selected, amount, onClose }) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [error, setError] = useState("");
  const [ready, setReady] = useState(false);

  function submit(event) {
    event.preventDefault();
    if (!isCompanyEmail(email)) {
      setError("Please enter a valid company email");
      setReady(false);
      return;
    }
    setError("");
    setReady(true);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="bid-modal" role="dialog" aria-modal="true" aria-labelledby="bid-title" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="Close bid form">×</button>
        <p className="eyebrow">PLACE THE NEXT BID</p>
        <h2 id="bid-title">{selected.length} slot{selected.length === 1 ? "" : "s"}</h2>
        <div className="bid-total"><span>Next bid</span><strong>{money(amount)}</strong></div>
        <form onSubmit={submit} noValidate>
          <label>Company / brand<input value={company} onChange={(event) => setCompany(event.target.value)} required /></label>
          <label>Company email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} aria-invalid={Boolean(error)} required /></label>
          {error && <p className="form-error" role="alert">{error}</p>}
          {ready && <p className="payment-note" role="status">Company email accepted. Payments are not enabled yet.</p>}
          <button className="primary-button full" type="submit">Continue to payment <span>→</span></button>
        </form>
        <p className="fine-print">No payment will be taken in this prototype.</p>
      </section>
    </div>
  );
}

function seedPlacement(selected, paintMeshes = []) {
  if (!selected.length) return null;
  const panelKey = SLOT_MAP[selected[0]].panel;
  const { panel, centerU, centerV } = slotBounds(selected);
  const slots = selectedSlots(selected);
  const entirePanel = isEntirePanelSelected(panel, selected);
  const [seedU, seedV] = clampToPlacementRegion(panel, slots, centerU, centerV, { entirePanel });
  const guess = panelFramePoint(panel, seedU, seedV);
  const guessNormal = panelFrameNormal(panel);

  if (paintMeshes?.length) {
    const hit = projectOntoPaintMeshes(paintMeshes, guess, guessNormal);
    if (hit) {
      return placementFromHit({
        panelMesh: panelKey,
        hit,
        rotation: 0,
        scale: DEFAULT_SCALE,
        selectedSlotIds: selected,
      });
    }
  }

  return {
    panelMesh: panelKey,
    surfacePoint: guess.toArray(),
    surfaceNormal: guessNormal.toArray(),
    localPoint: null,
    localNormal: null,
    uvCenter: [0.5, 0.5],
    rotation: 0,
    scale: DEFAULT_SCALE,
    selectedSlotIds: [...selected],
    logoAssetId: null,
    meshUuid: null,
  };
}

export default function App() {
  const [selected, setSelected] = useState(["driverDoor-1"]);
  const [logoUrl, setLogoUrl] = useState("");
  const [logoMeta, setLogoMeta] = useState(null);
  const [placement, setPlacement] = useState(() => seedPlacement(["driverDoor-1"]));
  const [baked, setBaked] = useState(null);
  const [baking, setBaking] = useState(false);
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [processingLogo, setProcessingLogo] = useState(false);
  const [pastPlacements, setPastPlacements] = useState([]);
  const [futurePlacements, setFuturePlacements] = useState([]);
  const [bids] = useState(INITIAL_BIDS);
  const [modalOpen, setModalOpen] = useState(false);
  const [railMinimized, setRailMinimized] = useState(false);
  const [phase, setPhase] = useState("presentation");
  const [progress, setProgress] = useState(0);
  const [cursorLabel, setCursorLabel] = useState("");
  const paintApiRef = useRef({ paintMeshes: [], paintMaterials: [] });
  const activePanel = selected.length ? SLOT_MAP[selected[0]].panel : "hood";
  const panelKeys = Object.keys(PANELS);
  const activePanelIndex = Math.max(0, panelKeys.indexOf(activePanel));
  const amount = selected.length ? nextBidForSlots(selected, SLOT_MAP, bids) : 0;
  const coverage = coverageRatio(selected, PANELS[activePanel]);
  const weights = sceneWeights(progress);
  const interactive = phase === "editing" || phase === "handoff" || phase === "configurator";
  const tour = panelTourFromProgress(progress);
  const railOpacity = interactive ? 1 : 0;
  const railUnlocked = interactive;
  const panelCardOpacity = tour.mode === "panel" ? 1 : tour.mode === "studio" ? Math.max(0, 1 - weights.morph * 1.5) : 0;

  useSmoothScroll({
    onPhase: setPhase,
    onProgress: setProgress,
  });

  useEffect(() => {
    if (phase !== "editing" || !tour.panelKey) return;
    if (SLOT_MAP[selected[0]]?.panel === tour.panelKey) return;
    const next = [PANELS[tour.panelKey].slots[0].id];
    setSelected(next);
    setPlacement(seedPlacement(next, paintApiRef.current.paintMeshes));
    setBaked(null);
    setPastPlacements([]);
    setFuturePlacements([]);
    // Only follow scroll chapter changes — not manual selection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, tour.panelKey]);

  // Once paint meshes load, snap any frame-seeded placement onto real geometry.
  useEffect(() => {
    const meshes = paintApiRef.current.paintMeshes;
    if (!meshes?.length || !placement || placement.localPoint) return;
    const next = seedPlacement(selected, meshes);
    if (next?.localPoint) setPlacement(next);
  }, [selected, placement, progress]);

  useEffect(() => () => logoUrl && URL.revokeObjectURL(logoUrl), [logoUrl]);
  useEffect(() => () => {
    if (baked?.objectUrl) URL.revokeObjectURL(baked.objectUrl);
    if (baked?.texture) baked.texture.dispose();
  }, [baked]);

  function clearBake() {
    setBaked(null);
  }

  function editPlacement(next) {
    clearBake();
    setPlacement(next);
  }

  function checkpoint() {
    if (!placement) return;
    setPastPlacements((items) => [...items.slice(-19), {
      ...placement,
      surfacePoint: [...placement.surfacePoint],
      surfaceNormal: [...placement.surfaceNormal],
      localPoint: placement.localPoint ? [...placement.localPoint] : null,
      localNormal: placement.localNormal ? [...placement.localNormal] : null,
      uvCenter: [...placement.uvCenter],
      selectedSlotIds: [...placement.selectedSlotIds],
    }]);
    setFuturePlacements([]);
  }

  function undoTransform() {
    if (!pastPlacements.length) return;
    const previous = pastPlacements[pastPlacements.length - 1];
    setPastPlacements((items) => items.slice(0, -1));
    setFuturePlacements((items) => [placement, ...items]);
    clearBake();
    setPlacement(previous);
  }

  function redoTransform() {
    if (!futurePlacements.length) return;
    const next = futurePlacements[0];
    setPastPlacements((items) => [...items, placement]);
    setFuturePlacements((items) => items.slice(1));
    clearBake();
    setPlacement(next);
  }

  function toggleSlot(id) {
    const panel = SLOT_MAP[id].panel;
    clearBake();
    setSelected((current) => {
      let next;
      if (current.length && SLOT_MAP[current[0]].panel !== panel) next = [id];
      else if (current.includes(id)) next = current.length === 1 ? current : current.filter((slotId) => slotId !== id);
      else next = [...current, id];
      setPlacement((prev) => {
        const seeded = seedPlacement(next, paintApiRef.current.paintMeshes);
        return prev
          ? updatePlacement(seeded, { rotation: prev.rotation, scale: prev.scale, logoAssetId: prev.logoAssetId })
          : seeded;
      });
      return next;
    });
  }

  function choosePanel(panelKey) {
    clearBake();
    const next = [PANELS[panelKey].slots[0].id];
    setSelected(next);
    setPlacement(seedPlacement(next, paintApiRef.current.paintMeshes));
    setPastPlacements([]);
    setFuturePlacements([]);
    if (phase === "editing" || phase === "handoff") {
      const stage = document.querySelector("#cinema-stage");
      if (stage) {
        const scrollable = Math.max(1, stage.offsetHeight - window.innerHeight);
        const top = stage.offsetTop + progressForPanel(panelKey) * scrollable;
        window.scrollTo({ top, behavior: cinemaRefs.reducedMotion.current ? "auto" : "smooth" });
      }
    }
  }

  async function bakePlacement() {
    if (!logoUrl || !placement || !selected.length) return;
    setBaking(true);
    setUploadError("");
    try {
      const meshes = paintApiRef.current.paintMeshes || [];
      const mesh = meshes.find((entry) => entry.uuid === placement.meshUuid) || meshes[0];
      if (!mesh) throw new Error("Paint mesh is not ready yet");

      mesh.updateWorldMatrix(true, false);
      const { position: localPos } = localProjectorFromPlacement(placement, mesh);
      const worldPoint = mesh.localToWorld(localPos.clone());
      const worldNormal = placement.localNormal
        ? new THREE.Vector3(...placement.localNormal).transformDirection(mesh.matrixWorld).normalize()
        : new THREE.Vector3(...placement.surfaceNormal).normalize();
      const raycaster = new THREE.Raycaster(
        worldPoint.clone().addScaledVector(worldNormal, 0.25),
        worldNormal.clone().multiplyScalar(-1),
      );
      const hit = raycaster.intersectObject(mesh, false)[0];
      const density = hit ? uvScaleFromHit(hit) : { uPerMeter: 0.28, vPerMeter: 0.28 };
      const canvas = await bakePlacementToAtlas({
        placement: hit
          ? updatePlacement(placement, {
            uvCenter: hit.uv ? [hit.uv.x, hit.uv.y] : placement.uvCenter,
            surfacePoint: worldPoint.toArray(),
            surfaceNormal: worldNormal.toArray(),
          })
          : placement,
        logoUrl,
        uPerMeter: density.uPerMeter,
        vPerMeter: density.vPerMeter,
      });
      const objectUrl = await canvasToObjectUrl(canvas);
      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.flipY = false;
      texture.needsUpdate = true;
      setBaked({ texture, objectUrl, meshUuid: mesh.uuid, placement: { ...placement } });
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setBaking(false);
    }
  }

  async function uploadLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setProcessingLogo(true);
    setUploadError("");
    try {
      const prepared = await prepareLogo(file);
      if (logoUrl) URL.revokeObjectURL(logoUrl);
      clearBake();
      setLogoUrl(prepared.url);
      setLogoMeta({ aspect: prepared.aspect, hull: prepared.hull, width: prepared.width, height: prepared.height });
      setFileName(file.name);
      setPlacement((current) => updatePlacement(current || seedPlacement(selected), {
        scale: DEFAULT_SCALE,
        rotation: 0,
        logoAssetId: file.name,
        selectedSlotIds: selected,
      }));
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setProcessingLogo(false);
      event.target.value = "";
    }
  }

  function enterStudio(event) {
    event?.preventDefault();
    cinemaRefs.progress.current = 1;
    cinemaRefs.smoothed.current = 1;
    cinemaRefs.phase.current = "configurator";
    setProgress(1);
    setPhase("configurator");
    const stage = document.querySelector("#cinema-stage");
    if (stage) {
      const top = stage.offsetTop + stage.offsetHeight - window.innerHeight;
      window.scrollTo({ top, behavior: cinemaRefs.reducedMotion.current ? "auto" : "smooth" });
    }
  }

  return (
    <main className={`app-shell phase-${phase}`}>
      <CustomCursor label={cursorLabel} visible={!modalOpen} />
      <header className="site-header">
        <a className="wordmark" href="#top">BRAND MY SUPRA</a>
        <nav>
          <a href="#studio" onClick={enterStudio}>3D studio</a>
          <a href="#auction">Bid areas</a>
          <a href="#how">How it works</a>
        </nav>
      </header>

      <section className="cinema-stage" id="cinema-stage">
        <div className="cinema-sticky" id="top">
          <div className="cinema-wordmark" aria-hidden="true" style={{ opacity: Math.max(0, weights.brand) * 0.42 }}>SUPRA</div>
          <div className="cinema-viewport">
            <CinemaCanvas phase={phase} onCursorLabel={setCursorLabel}>
              {(setDragging) => (
                <SupraModel
                  logoUrl={logoUrl}
                  logoMeta={logoMeta}
                  selected={selected}
                  placement={placement}
                  setPlacement={editPlacement}
                  setDragging={setDragging}
                  checkpoint={checkpoint}
                  locked={Boolean(baked)}
                  baked={baked}
                  onPanelPick={choosePanel}
                  paintApiRef={paintApiRef}
                  interactive={interactive}
                />
              )}
            </CinemaCanvas>
            <div className="viewer-hint cinema-hint" style={{ opacity: Math.max(railOpacity, panelCardOpacity * 0.85) }}>
              {baked
                ? "BAKED INTO BODY UV TEXTURE · SCROLL FOR THE NEXT PANEL"
                : logoUrl
                  ? "DRAG TO PLACE · HOLD RIGHT-CLICK TO ORBIT · CUBE SNAPS VIEW"
                  : phase === "configurator"
                    ? "CLICK A PANEL · DRAG OR RIGHT-CLICK TO ORBIT"
                    : interactive
                      ? "CONFIGURE THIS PANEL · RIGHT-CLICK ORBITS THE CAR"
                      : "SCROLL TO MOVE THROUGH EACH PANEL"}
            </div>
          </div>

          <div className="cinema-copy" style={{ opacity: Math.max(0, weights.brand), pointerEvents: weights.brand > 0.2 ? "auto" : "none" }}>
            <p className="hero-title" aria-label="Your brand on my Supra">YOUR<br />BRAND<br />ON MY<br /><em>SUPRA.</em></p>
            <p className="hero-caption">Twenty sponsor slots. Scroll each body panel, place your logo, then free-orbit the studio.</p>
            <MagneticButton className="hero-cta" href="#studio" onClick={enterStudio}>
              ENTER STUDIO <span>✎</span>
            </MagneticButton>
            <p className="scroll-cue">SCROLL THE PANELS <span>↓</span></p>
          </div>

          <div className="panel-chapter" style={{ opacity: panelCardOpacity, pointerEvents: "none" }} aria-hidden={panelCardOpacity < 0.05}>
            {tour.current && (
              <>
                <p className="panel-chapter-index">{tour.current.index} / 08</p>
                <h2 className="panel-chapter-title">{tour.current.label}</h2>
                <p className="panel-chapter-line">{tour.current.line}</p>
                <p className="panel-chapter-meta">
                  {PANELS[tour.current.key].slots.length} slot{PANELS[tour.current.key].slots.length === 1 ? "" : "s"}
                  {" · "}
                  from {money(Math.min(...PANELS[tour.current.key].slots.map((slot) => bids[slot.id])))}
                </p>
                <div className="panel-chapter-dots" aria-hidden="true">
                  {Array.from({ length: 8 }, (_, index) => (
                    <i key={index} className={index === tour.panelIndex ? "active" : ""} />
                  ))}
                </div>
              </>
            )}
          </div>

          <aside
            id="studio"
            className={`controls cinema-rail ${railUnlocked ? "is-unlocked" : "is-locked"}${railMinimized ? " is-minimized" : ""}`}
            style={{
              opacity: railOpacity,
              transform: railMinimized ? undefined : `translate3d(${(1 - railOpacity) * 28}px, 0, 0)`,
              pointerEvents: railUnlocked ? "auto" : "none",
            }}
            aria-expanded={!railMinimized}
          >
            {railMinimized ? (
              <button
                type="button"
                className="rail-expand"
                onClick={() => setRailMinimized(false)}
                aria-label="Expand logo configurator"
              >
                <span className="rail-expand-chevron" aria-hidden="true">‹</span>
                <span className="rail-expand-label">Configurator</span>
                <i className="rail-expand-tab" aria-hidden="true" />
              </button>
            ) : (
              <>
                <div className="rail-header">
                  <div><small>LOGO CONFIGURATOR</small><b>{baked ? "Placement baked" : logoUrl ? "Fine tune" : interactive ? "Choose placement" : "Unlocking…"}</b></div>
                  <div className="rail-header-actions">
                    <div className="history-controls" aria-label="Placement history">
                      <button onClick={undoTransform} disabled={!pastPlacements.length || !interactive} aria-label="Undo placement">↶</button>
                      <button onClick={redoTransform} disabled={!futurePlacements.length || !interactive} aria-label="Redo placement">↷</button>
                    </div>
                    <button
                      type="button"
                      className="rail-minimize"
                      onClick={() => setRailMinimized(true)}
                      aria-label="Minimize logo configurator"
                      title="Minimize"
                    >
                      ›
                    </button>
                  </div>
                </div>
                <div className="step-meter" aria-label={logoUrl ? "Step 2 of 2" : "Step 1 of 2"}><i className="complete" /><i className={logoUrl ? "complete" : ""} /></div>
                <div className="control-step"><span>01</span><div><b>Choose an area</b><p>Slots set price and coverage — not a grid on the car.</p></div></div>
                <div className="panel-tabs-nav" role="group" aria-label="Body panels">
                  <button
                    type="button"
                    className="panel-tab-arrow"
                    aria-label="Previous panel"
                    disabled={!interactive || activePanelIndex <= 0}
                    onClick={() => choosePanel(panelKeys[activePanelIndex - 1])}
                  >
                    ‹
                  </button>
                  <div className="panel-tabs">
                    {panelKeys.map((key) => (
                      <button key={key} className={activePanel === key ? "active" : ""} aria-pressed={activePanel === key} onClick={() => choosePanel(key)} disabled={!interactive}>{PANELS[key].label}</button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="panel-tab-arrow"
                    aria-label="Next panel"
                    disabled={!interactive || activePanelIndex >= panelKeys.length - 1}
                    onClick={() => choosePanel(panelKeys[activePanelIndex + 1])}
                  >
                    ›
                  </button>
                </div>
                <div className="slot-picker">
                  {PANELS[activePanel].slots.map((slot) => (
                    <button key={slot.id} className={selected.includes(slot.id) ? "selected" : ""} aria-pressed={selected.includes(slot.id)} onClick={() => toggleSlot(slot.id)} disabled={!interactive}>
                      <b>{slot.label.replace(PANELS[activePanel].label, "").trim()}</b><span>Coverage</span><small>{money(bids[slot.id])}</small>
                    </button>
                  ))}
                </div>
                <p className="coverage-readout">{Math.round(coverage * 100)}% panel coverage</p>
                <button className="text-button" disabled={!interactive} onClick={() => { clearBake(); setSelected(PANELS[activePanel].slots.map((slot) => slot.id)); setPlacement(seedPlacement(PANELS[activePanel].slots.map((slot) => slot.id), paintApiRef.current.paintMeshes)); }}>Select entire area</button>

                <div className="control-step"><span>02</span><div><b>Upload your logo</b><p>Transparent PNG or SVG works best.</p></div></div>
                <label className={`upload-button ${!interactive ? "is-disabled" : ""}`}><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} disabled={processingLogo || !interactive} /><span>{processingLogo ? "Preparing logo…" : fileName || "Choose logo file"}</span><b>＋</b></label>
                {uploadError && <p className="form-error upload-error" role="alert">{uploadError}</p>}

                {logoUrl && placement && (
                  <div className="transform-controls tactile-panel">
                    {baked ? (
                      <div className="baked-status">
                        <span>✓</span>
                        <div><b>UV texture baked</b><small>Editable placement kept</small></div>
                        <button type="button" onClick={clearBake}>Edit</button>
                      </div>
                    ) : (
                      <>
                        <div className="direct-manipulation"><span>POSITION</span><b>Raycast on painted body</b></div>
                        <label>
                          <span>Scale</span>
                          <input type="range" min="0.25" max="1" step="0.01" value={placement.scale} onPointerDown={checkpoint} onChange={(event) => editPlacement(updatePlacement(placement, { scale: Number(event.target.value) }))} />
                          <output>{Math.round(placement.scale * 100)}%</output>
                        </label>
                        <label className="rotation-control">
                          <span>Rotation</span>
                          <div className="dial" style={{ "--dial-angle": `${placement.rotation}rad` }}><i /></div>
                          <input type="range" min="-3.14" max="3.14" step="0.01" value={placement.rotation} onPointerDown={checkpoint} onChange={(event) => editPlacement(updatePlacement(placement, { rotation: Number(event.target.value) }))} />
                          <output>{Math.round(placement.rotation * 180 / Math.PI)}°</output>
                        </label>
                        <div className="placement-actions">
                          <button type="button" className="reset-button" onClick={() => { checkpoint(); editPlacement(updatePlacement(placement, { scale: DEFAULT_SCALE, rotation: 0 })); }}>Reset</button>
                          <button type="button" className="bake-button" onClick={bakePlacement} disabled={baking}>{baking ? "Baking…" : "Bake to UV"}</button>
                        </div>
                      </>
                    )}
                  </div>
                )}
                <div className="selection-summary"><span>{selected.length} slot{selected.length === 1 ? "" : "s"} selected</span><strong>{money(amount)}</strong><small>next combined bid</small></div>
                <MagneticButton as="button" className="primary-button full" onClick={() => setModalOpen(true)}>
                  Place bid <span>→</span>
                </MagneticButton>
              </>
            )}
          </aside>
        </div>
      </section>

      <section className="auction-section" id="auction">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE AUCTION</p>
            <RevealText as="h2">Twenty slots.</RevealText>
          </div>
          <RevealText as="p">Every slot is a separate auction. Select adjacent slots in the studio for larger coverage.</RevealText>
        </div>
        <div className="auction-list">
          {ALL_SLOTS.map((slot, index) => (
            <article key={slot.id} className="auction-row">
              <span className="slot-number">{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{slot.label}</h3><p>{PANELS[slot.panel].label}</p></div>
              <div className="leader"><small>HELD BY</small><b>OPEN</b></div>
              <div className="current-bid"><small>CURRENT BID</small><b>{money(bids[slot.id])}</b></div>
              <button onClick={() => { clearBake(); setSelected([slot.id]); setPlacement(seedPlacement([slot.id], paintApiRef.current.paintMeshes)); enterStudio(); }}>CUSTOMIZE <span>→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="how-section" id="how">
        <p className="eyebrow">HOW IT WORKS</p>
        <RevealText as="h2">Three moves.</RevealText>
        <div className="steps">
          <article><span>01</span><h3>Choose your space</h3><p>Select one slot or combine adjacent slots on the same body panel for more coverage.</p></article>
          <article><span>02</span><h3>Design it in 3D</h3><p>Upload your logo, drag it along the painted surface, and bake it into the body texture.</p></article>
          <article><span>03</span><h3>Win the auction</h3><p>Winning artwork is reviewed and becomes part of the final livery after the auction.</p></article>
        </div>
      </section>

      <section className="disclaimer">
        <p className="eyebrow">PURCHASE CONDITION</p>
        <p>Winning a sponsorship slot does not guarantee physical installation. Winning logos will be produced and applied to the vehicle only if the organizer completes the purchase of the Toyota GR Supra. If the vehicle is not purchased by the date stated in the final auction terms, winning bidders will be eligible for a refund under those terms.</p>
      </section>

      <footer>
        <a className="wordmark" href="#top">BRAND MY SUPRA</a>
        <p className="model-credit">3D model: <a href="https://skfb.ly/oF6Uy" target="_blank" rel="noreferrer">“Toyota Supra MK5 A90”</a> by lbrtwlk, licensed under <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution</a>.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
      {modalOpen && <BidModal selected={selected} amount={amount} onClose={() => setModalOpen(false)} />}
    </main>
  );
}

useGLTF.preload("/models/supra.optimized.glb?v=3");

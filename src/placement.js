import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { PANELS } from "./slots.js";

/** Model-space placement for surface decals and re-editable UV bake. */
export function createPlacement({
  panelMesh,
  surfacePoint,
  surfaceNormal,
  localPoint = null,
  localNormal = null,
  uvCenter = [0.5, 0.5],
  rotation = 0,
  scale = 0.82,
  selectedSlotIds = [],
  logoAssetId = null,
  meshUuid = null,
}) {
  return {
    panelMesh,
    surfacePoint: [...surfacePoint],
    surfaceNormal: [...surfaceNormal],
    localPoint: localPoint ? [...localPoint] : null,
    localNormal: localNormal ? [...localNormal] : null,
    uvCenter: [...uvCenter],
    rotation,
    scale,
    selectedSlotIds: [...selectedSlotIds],
    logoAssetId,
    meshUuid,
  };
}

export function updatePlacement(placement, patch) {
  const next = { ...placement, ...patch };
  if (patch.surfacePoint) next.surfacePoint = [...patch.surfacePoint];
  if (patch.surfaceNormal) next.surfaceNormal = [...patch.surfaceNormal];
  if (patch.localPoint) next.localPoint = [...patch.localPoint];
  if (patch.localNormal) next.localNormal = [...patch.localNormal];
  if (patch.uvCenter) next.uvCenter = [...patch.uvCenter];
  if (patch.selectedSlotIds) next.selectedSlotIds = [...patch.selectedSlotIds];
  return next;
}

export function worldNormalFromHit(hit) {
  if (hit.face) {
    return hit.face.normal.clone().transformDirection(hit.object.matrixWorld).normalize();
  }
  return (hit.normal?.clone() ?? new THREE.Vector3(0, 1, 0)).normalize();
}

export function placementFromHit({
  panelMesh,
  hit,
  rotation = 0,
  scale = 0.82,
  selectedSlotIds = [],
  logoAssetId = null,
}) {
  hit.object.updateWorldMatrix(true, false);
  const worldPoint = hit.point.clone();
  const worldNormal = worldNormalFromHit(hit);
  const localPoint = hit.object.worldToLocal(worldPoint.clone());
  const localNormal = hit.face?.normal?.clone().normalize()
    ?? worldNormal.clone().transformDirection(new THREE.Matrix4().copy(hit.object.matrixWorld).invert()).normalize();

  return createPlacement({
    panelMesh,
    surfacePoint: worldPoint.toArray(),
    surfaceNormal: worldNormal.toArray(),
    localPoint: localPoint.toArray(),
    localNormal: localNormal.toArray(),
    uvCenter: hit.uv ? [hit.uv.x, hit.uv.y] : [0.5, 0.5],
    rotation,
    scale,
    selectedSlotIds,
    logoAssetId,
    meshUuid: hit.object.uuid,
  });
}

/**
 * Decal projector Euler in the same space as `normalArray`.
 * Matches drei's Decal lookAt convention so Z projects into the surface.
 */
export function orientationFromNormal(normalArray, rotation = 0) {
  const normal = new THREE.Vector3(...normalArray).normalize();
  const helper = new THREE.Object3D();
  helper.position.set(0, 0, 0);
  helper.lookAt(normal);
  helper.rotateZ(Math.PI);
  helper.rotateY(Math.PI);
  helper.rotateZ(rotation);
  return helper.rotation.clone();
}

/**
 * Decal orientation that reads upright on its panel: +x follows the panel's uAxis, +z is the
 * outward surface normal, and `rotation` spins the logo about that normal.
 * All vectors are mesh-local; `toModel` carries mesh-local directions into car-group space.
 */
function panelOrientation(panel, localNormal, toModel, rotation) {
  const normal = localNormal.clone().normalize();
  const right = new THREE.Vector3(...panel.uAxis).applyMatrix3(new THREE.Matrix3().setFromMatrix4(toModel).invert());
  right.addScaledVector(normal, -right.dot(normal));
  if (right.lengthSq() < 1e-6) return orientationFromNormal(normal.toArray(), rotation);
  right.normalize();
  const up = normal.clone().cross(right);
  const basis = new THREE.Matrix4().makeBasis(right, up, normal)
    .multiply(new THREE.Matrix4().makeRotationZ(rotation));
  return new THREE.Euler().setFromRotationMatrix(basis);
}

/** Resolve mesh-local projector pose from a stored placement. */
export function localProjectorFromPlacement(placement, mesh) {
  mesh.updateWorldMatrix(true, false);
  const panel = PANELS[placement.panelMesh];
  const root = modelRootFromObject(mesh);
  root.updateWorldMatrix(true, false);
  const toModel = new THREE.Matrix4().copy(root.matrixWorld).invert().multiply(mesh.matrixWorld);
  const orient = (localNormal) => (panel
    ? panelOrientation(panel, localNormal, toModel, placement.rotation)
    : orientationFromNormal(localNormal.toArray(), placement.rotation));

  if (placement.localPoint && placement.localNormal) {
    return {
      position: new THREE.Vector3(...placement.localPoint),
      orientation: orient(new THREE.Vector3(...placement.localNormal)),
    };
  }
  const worldPoint = new THREE.Vector3(...placement.surfacePoint);
  const worldNormal = new THREE.Vector3(...placement.surfaceNormal).normalize();
  const localPoint = mesh.worldToLocal(worldPoint.clone());
  const inv = new THREE.Matrix4().copy(mesh.matrixWorld).invert();
  const localNormal = worldNormal.clone().transformDirection(inv).normalize();
  return { position: localPoint, orientation: orient(localNormal) };
}

/**
 * Build DecalGeometry in the paint mesh's local space so it can be parented
 * under the mesh (and follow car/group transforms correctly).
 */
export function buildLocalDecalGeometry(mesh, localPosition, orientation, size) {
  mesh.updateWorldMatrix(true, false);
  const saved = mesh.matrixWorld.clone();
  mesh.matrixWorld.identity();
  const geometry = new DecalGeometry(mesh, localPosition, orientation, size);
  mesh.matrixWorld.copy(saved);
  return geometry;
}

export function coverageRatio(selectedIds, panel) {
  if (!panel?.slots?.length) return 1;
  const total = panel.slots.reduce((sum, slot) => sum + slot.width * slot.height, 0);
  const chosen = selectedIds.reduce((sum, id) => {
    const slot = panel.slots.find((entry) => entry.id === id);
    return sum + (slot ? slot.width * slot.height : 0);
  }, 0);
  return Math.max(0.2, Math.min(1, chosen / total));
}

export function panelFramePoint(panel, u, v) {
  const origin = new THREE.Vector3(...panel.origin);
  const uAxis = new THREE.Vector3(...panel.uAxis).normalize();
  const vAxis = new THREE.Vector3(...panel.vAxis).normalize();
  return origin.addScaledVector(uAxis, u).addScaledVector(vAxis, v);
}

export function panelFrameNormal(panel) {
  return new THREE.Vector3(...panel.normal).normalize();
}

export function worldToPanelUV(panel, point) {
  const origin = new THREE.Vector3(...panel.origin);
  const uAxis = new THREE.Vector3(...panel.uAxis).normalize();
  const vAxis = new THREE.Vector3(...panel.vAxis).normalize();
  const delta = point.clone().sub(origin);
  return [delta.dot(uAxis), delta.dot(vAxis)];
}

/** The car group (direct child of the scene): the space panel frames are defined in. */
export function modelRootFromObject(object) {
  let root = object;
  while (root.parent && root.parent.type !== "Scene") root = root.parent;
  return root;
}

export function worldToModelPoint(object, worldPoint) {
  const root = modelRootFromObject(object);
  root.updateWorldMatrix(true, false);
  return root.worldToLocal(worldPoint.clone());
}

export function modelToWorldPoint(object, modelPoint) {
  const root = modelRootFromObject(object);
  root.updateWorldMatrix(true, false);
  return root.localToWorld(modelPoint.clone());
}

/** Cast onto paint meshes from a panel-frame guess so logos sit on real geometry. */
export function projectOntoPaintMeshes(meshes, guessPointModel, guessNormalModel, { reach = 0.9 } = {}) {
  if (!meshes?.length) return null;
  const root = modelRootFromObject(meshes[0]);
  root.updateWorldMatrix(true, false);
  const guessPoint = root.localToWorld(guessPointModel.clone());
  const guessNormal = guessNormalModel.clone().transformDirection(root.matrixWorld).normalize();
  const raycaster = new THREE.Raycaster();
  const candidates = [];
  meshes.forEach((mesh) => mesh.updateWorldMatrix(true, false));

  for (const sign of [1, -1]) {
    const origin = guessPoint.clone().addScaledVector(guessNormal, reach * sign);
    raycaster.set(origin, guessNormal.clone().multiplyScalar(-sign));
    // Skip surfaces facing away from the panel (e.g. the far side of the car through a wheel arch).
    const hit = raycaster.intersectObjects(meshes, false).find((entry) => worldNormalFromHit(entry).dot(guessNormal) > 0.3);
    if (hit) candidates.push(hit);
  }

  if (!candidates.length) {
    raycaster.set(guessPoint.clone().add(new THREE.Vector3(0, 2.5, 0)), new THREE.Vector3(0, -1, 0));
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits[0]) candidates.push(hits[0]);
  }

  if (!candidates.length) return null;
  candidates.sort((a, b) => a.distance - b.distance);
  return candidates[0];
}

/** Rough world↔UV scale from the hit triangle, for atlas bake sizing. */
export function uvScaleFromHit(hit) {
  const geometry = hit.object.geometry;
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  if (!uv || hit.faceIndex == null) return { uPerMeter: 0.35, vPerMeter: 0.35 };

  const index = geometry.index;
  const face = hit.faceIndex * 3;
  const i0 = index ? index.getX(face) : face;
  const i1 = index ? index.getX(face + 1) : face + 1;
  const i2 = index ? index.getX(face + 2) : face + 2;

  const p0 = new THREE.Vector3().fromBufferAttribute(position, i0);
  const p1 = new THREE.Vector3().fromBufferAttribute(position, i1);
  const p2 = new THREE.Vector3().fromBufferAttribute(position, i2);
  hit.object.localToWorld(p0);
  hit.object.localToWorld(p1);
  hit.object.localToWorld(p2);

  const uv0 = new THREE.Vector2().fromBufferAttribute(uv, i0);
  const uv1 = new THREE.Vector2().fromBufferAttribute(uv, i1);
  const uv2 = new THREE.Vector2().fromBufferAttribute(uv, i2);

  const e1 = p1.distanceTo(p0) || 1e-4;
  const e2 = p2.distanceTo(p0) || 1e-4;
  const u1 = uv1.distanceTo(uv0) || 1e-4;
  const u2 = uv2.distanceTo(uv0) || 1e-4;
  return {
    uPerMeter: (u1 / e1 + u2 / e2) / 2,
    vPerMeter: (u1 / e1 + u2 / e2) / 2,
  };
}

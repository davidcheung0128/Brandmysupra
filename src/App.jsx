import { Canvas, useLoader, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, OrbitControls, useGLTF } from "@react-three/drei";
import React, { Suspense, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import { DecalGeometry } from "three/examples/jsm/geometries/DecalGeometry.js";
import { ALL_SLOTS, INITIAL_BIDS, PANELS, SLOT_MAP } from "./slots.js";
import { isCompanyEmail, money, nextBidForSlots } from "./domain.js";
import { clampToPanelMask, panelMaskPoints } from "./surface.js";

const DEFAULT_TRANSFORM = { x: 0, y: 0, scale: 0.82, rotation: 0 };
const BAKED_TRANSFORM = { x: 0, y: 0, scale: 1, rotation: 0 };

function add(a, b, amount) {
  return a.map((value, index) => value + b[index] * amount);
}

function slotBounds(selected) {
  const slots = selected.map((id) => SLOT_MAP[id]);
  const panel = PANELS[slots[0].panel];
  const minU = Math.min(...slots.map((slot) => slot.u - slot.width / 2));
  const maxU = Math.max(...slots.map((slot) => slot.u + slot.width / 2));
  const minV = Math.min(...slots.map((slot) => slot.v - slot.height / 2));
  const maxV = Math.max(...slots.map((slot) => slot.v + slot.height / 2));
  return { panel, minU, maxU, minV, maxV, centerU: (minU + maxU) / 2, centerV: (minV + maxV) / 2 };
}

function projectedGeometries(meshes, position, orientation, size) {
  return meshes
    .map((mesh) => new DecalGeometry(mesh, position, orientation, size))
    .filter((geometry) => geometry.attributes.position.count > 0);
}

function panelMaskTexture(panel, centerU, centerV, width, height, rotation = 0) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 256;
  const context = canvas.getContext("2d");
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  context.fillStyle = "white";
  context.beginPath();
  panelMaskPoints(panel).forEach(([u, v], index) => {
    const dx = u - centerU;
    const dy = v - centerV;
    const localX = dx * cos + dy * sin;
    const localY = -dx * sin + dy * cos;
    const x = (localX / width + 0.5) * canvas.width;
    const y = (0.5 - localY / height) * canvas.height;
    if (index) context.lineTo(x, y); else context.moveTo(x, y);
  });
  context.closePath();
  context.fill();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

function logoSize(image, selected, scale) {
  const { minU, maxU, minV, maxV } = slotBounds(selected);
  const ratio = image?.width && image?.height ? image.width / image.height : 1;
  let width = (maxU - minU) * scale;
  let height = width / ratio;
  const maxHeight = (maxV - minV) * scale;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * ratio;
  }
  return { width, height };
}

async function bakeDecalCanvas(url, selected, transform) {
  const image = new Image();
  image.src = url;
  await image.decode();
  const { panel, minU, maxU, minV, maxV, centerU, centerV } = slotBounds(selected);
  const worldWidth = maxU - minU;
  const worldHeight = maxV - minV;
  const longest = 2048;
  const canvas = document.createElement("canvas");
  canvas.width = worldWidth >= worldHeight ? longest : Math.max(1, Math.round(longest * worldWidth / worldHeight));
  canvas.height = worldHeight >= worldWidth ? longest : Math.max(1, Math.round(longest * worldHeight / worldWidth));
  const context = canvas.getContext("2d");
  const x = (u) => ((u - minU) / worldWidth) * canvas.width;
  const y = (v) => ((maxV - v) / worldHeight) * canvas.height;
  context.beginPath();
  panelMaskPoints(panel).forEach(([u, v], index) => index ? context.lineTo(x(u), y(v)) : context.moveTo(x(u), y(v)));
  context.closePath();
  context.clip();
  const size = logoSize(image, selected, transform.scale);
  context.translate(x(centerU + transform.x), y(centerV + transform.y));
  context.rotate(-transform.rotation);
  context.drawImage(image, -size.width / worldWidth * canvas.width / 2, -size.height / worldHeight * canvas.height / 2, size.width / worldWidth * canvas.width, size.height / worldHeight * canvas.height);
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Could not bake this logo")), "image/png"));
  return URL.createObjectURL(blob);
}

async function rasterizeAndTrim(file) {
  const allowed = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
  if (!allowed.has(file.type)) throw new Error("Upload a PNG, JPG, WebP, or SVG logo");
  if (file.size > 10 * 1024 * 1024) throw new Error("Logo files must be smaller than 10 MB");

  const sourceUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = sourceUrl;
    await image.decode();
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d", { willReadFrequently: true });
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, top = canvas.height, right = -1, bottom = -1;
    for (let y = 0; y < canvas.height; y += 1) {
      for (let x = 0; x < canvas.width; x += 1) {
        if (pixels[(y * canvas.width + x) * 4 + 3] < 8) continue;
        left = Math.min(left, x); right = Math.max(right, x);
        top = Math.min(top, y); bottom = Math.max(bottom, y);
      }
    }
    if (right < left) throw new Error("The uploaded logo is empty");
    const padding = 4;
    left = Math.max(0, left - padding); top = Math.max(0, top - padding);
    right = Math.min(canvas.width - 1, right + padding); bottom = Math.min(canvas.height - 1, bottom + padding);
    const trimmed = document.createElement("canvas");
    trimmed.width = right - left + 1; trimmed.height = bottom - top + 1;
    trimmed.getContext("2d").drawImage(canvas, left, top, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
    const blob = await new Promise((resolve, reject) => trimmed.toBlob((value) => value ? resolve(value) : reject(new Error("Could not process this logo")), "image/png"));
    return URL.createObjectURL(blob);
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}

function SlotSurface({ panel, slot, active, onToggle }) {
  const [hovered, setHovered] = useState(false);
  const position = add(add(panel.origin, panel.uAxis, slot.u), panel.vAxis, slot.v);
  return (
    <group position={position} rotation={panel.rotation}>
      <mesh
        onPointerOver={(event) => { event.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
        onClick={(event) => { event.stopPropagation(); onToggle(slot.id); }}
      >
        <planeGeometry args={[slot.width, slot.height]} />
        <meshStandardMaterial
          color="#ef3e2f"
          transparent
          opacity={0}
          roughness={0.42}
          depthWrite={false}
          polygonOffset
          polygonOffsetFactor={-2}
        />
      </mesh>
      <lineSegments visible={hovered}>
        <edgesGeometry args={[new THREE.PlaneGeometry(slot.width, slot.height)]} />
        <lineBasicMaterial color="#ff6658" transparent opacity={active ? 0.45 : 0.9} />
      </lineSegments>
    </group>
  );
}

function PanelHighlight({ selected, paintMeshes, logoVisible }) {
  const { panel, minU, maxU, minV, maxV, centerU, centerV } = slotBounds(selected);
  const positionArray = add(add(panel.origin, panel.uAxis, centerU), panel.vAxis, centerV);
  const position = new THREE.Vector3(...positionArray);
  const orientation = new THREE.Euler(...panel.rotation);
  const size = new THREE.Vector3((maxU - minU) * 0.96, (maxV - minV) * 0.96, 0.42);
  const geometries = useMemo(() => projectedGeometries(paintMeshes, position, orientation, size), [paintMeshes, selected.join("|")]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  return geometries.map((geometry, index) => (
    <mesh key={index} geometry={geometry} renderOrder={3}>
      <meshStandardMaterial color="#ef3e2f" transparent opacity={logoVisible ? 0.07 : 0.28} roughness={0.35} depthWrite={false} polygonOffset polygonOffsetFactor={-4} />
    </mesh>
  ));
}

function SelectionSurface({ panelKey, selected, onToggle }) {
  const panel = PANELS[panelKey];
  return panel.slots.map((slot) => (
    <SlotSurface
      key={slot.id}
      panel={panel}
      slot={slot}
      active={selected.includes(slot.id)}
      onToggle={onToggle}
    />
  ));
}

function ProjectedLogo({ url, selected, transform, paintMeshes }) {
  const texture = useLoader(THREE.TextureLoader, url);
  const { panel, minU, maxU, minV, maxV, centerU: slotCenterU, centerV: slotCenterV } = slotBounds(selected);
  const centerU = slotCenterU + transform.x;
  const centerV = slotCenterV + transform.y;
  const position = add(add(panel.origin, panel.uAxis, centerU), panel.vAxis, centerV);
  const { width, height } = logoSize(texture.image, selected, transform.scale);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  const orientation = new THREE.Euler(panel.rotation[0], panel.rotation[1], panel.rotation[2] + transform.rotation);
  const size = new THREE.Vector3(Math.max(width, 0.12), Math.max(height, 0.12), 0.42);
  const geometries = useMemo(() => projectedGeometries(paintMeshes, new THREE.Vector3(...position), orientation, size), [paintMeshes, position.join(), orientation.x, orientation.y, orientation.z, size.x, size.y]);
  const mask = useMemo(() => panelMaskTexture(panel, centerU, centerV, size.x, size.y, transform.rotation), [panel, centerU, centerV, size.x, size.y, transform.rotation]);
  useEffect(() => () => geometries.forEach((geometry) => geometry.dispose()), [geometries]);
  useEffect(() => () => mask.dispose(), [mask]);

  return (
    <group>
      {geometries.map((geometry, index) => (
        <mesh key={index} geometry={geometry} renderOrder={4}>
          <meshBasicMaterial map={texture} alphaMap={mask} transparent alphaTest={0.08} toneMapped={false} depthWrite={false} polygonOffset polygonOffsetFactor={-5} />
        </mesh>
      ))}
    </group>
  );
}

function LogoDragSurface({ selected, transform, setTransform, setDragging, checkpoint, paintMeshes }) {
  const [dragging, setLocalDragging] = useState(false);
  useEffect(() => () => { document.body.style.cursor = ""; }, []);
  const { panel, minU, maxU, minV, maxV, centerU, centerV } = slotBounds(selected);
  const position = add(add(panel.origin, panel.uAxis, centerU), panel.vAxis, centerV);
  const updatePosition = (event) => {
    if (!dragging) return;
    event.stopPropagation();
    const raycaster = new THREE.Raycaster();
    raycaster.ray.copy(event.ray);
    paintMeshes.forEach((mesh) => mesh.updateWorldMatrix(true, false));
    const hit = raycaster.intersectObjects(paintMeshes, false)[0];
    if (!hit) return;
    const delta = hit.point.clone().sub(new THREE.Vector3(...panel.origin));
    const u = delta.dot(new THREE.Vector3(...panel.uAxis).normalize());
    const v = delta.dot(new THREE.Vector3(...panel.vAxis).normalize());
    const [maskedU, maskedV] = clampToPanelMask(panel, u, v);
    setTransform({
      ...transform,
      x: maskedU - centerU,
      y: maskedV - centerV,
    });
  };
  const endDrag = (event) => {
    event.stopPropagation();
    event.target.releasePointerCapture?.(event.pointerId);
    setLocalDragging(false); setDragging(false);
    document.body.style.cursor = "";
  };
  return (
    <mesh
      position={position}
      rotation={panel.rotation}
      onPointerDown={(event) => {
        event.stopPropagation();
        checkpoint();
        event.target.setPointerCapture?.(event.pointerId);
        setLocalDragging(true); setDragging(true);
        document.body.style.cursor = "grabbing";
      }}
      onPointerMove={updatePosition}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerOver={() => { if (!dragging) document.body.style.cursor = "grab"; }}
      onPointerOut={() => { if (!dragging) document.body.style.cursor = ""; }}
    >
      <planeGeometry args={[maxU - minU + 0.35, maxV - minV + 0.35]} />
      <meshBasicMaterial transparent opacity={0} depthWrite={false} />
    </mesh>
  );
}

function CameraPreset({ view, controls }) {
  const { camera } = useThree();
  useEffect(() => {
    const positions = {
      hero: [6.7, 2.8, 7.5],
      front: [7.8, 1.95, 0],
      side: [0, 2.05, 8.25],
      top: [0.01, 8.7, 0.01],
    };
    camera.position.set(...positions[view]);
    camera.lookAt(0, 0.8, 0);
    if (controls.current) {
      controls.current.target.set(0, 0.8, 0);
      controls.current.update();
    }
  }, [camera, controls, view]);
  return null;
}

function SupraModel({ logoUrl, selected, transform, setTransform, setDragging, checkpoint, locked = false }) {
  const { scene } = useGLTF("/models/supra.optimized.glb?v=2");
  const { model, paintMeshes } = useMemo(() => {
    const clone = scene.clone(true);
    const bodyMeshes = [];
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
      const materials = sources.map(tuneMaterial);
      object.material = Array.isArray(object.material) ? materials : materials[0];
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
    return { model: clone, paintMeshes: bodyMeshes };
  }, [scene]);

  return <>
    <primitive object={model} />
    {selected.length > 0 && <PanelHighlight selected={selected} paintMeshes={paintMeshes} logoVisible={Boolean(logoUrl)} />}
    {logoUrl && selected.length > 0 && <>
      <ProjectedLogo url={logoUrl} selected={selected} transform={transform} paintMeshes={paintMeshes} />
      {!locked && <LogoDragSurface selected={selected} transform={transform} setTransform={setTransform} setDragging={setDragging} checkpoint={checkpoint} paintMeshes={paintMeshes} />}
    </>}
  </>;
}

function SupraPrototype({ selected, onToggle, logoUrl, transform, setTransform, setDragging, checkpoint, locked }) {
  return (
    <>
      <SupraModel logoUrl={logoUrl} selected={selected} transform={transform} setTransform={setTransform} setDragging={setDragging} checkpoint={checkpoint} locked={locked} />
      {Object.keys(PANELS).map((panelKey) => (
        <SelectionSurface key={panelKey} panelKey={panelKey} selected={selected} onToggle={onToggle} />
      ))}
    </>
  );
}

function BrightStudio() {
  return <>
    <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
      <planeGeometry args={[30, 30]} />
      <meshStandardMaterial color="#e8e8e5" roughness={0.86} metalness={0} />
    </mesh>
    <ContactShadows position={[0, 0.015, 0]} opacity={0.42} scale={14} blur={2.5} far={7} resolution={512} frames={1} color="#3f3f3b" />
  </>;
}

function LandingCar() {
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  return (
    <Canvas shadows={!mobile} frameloop="demand" dpr={mobile ? 1 : [1, 1.75]} gl={{ antialias: !mobile, powerPreference: "high-performance" }} camera={{ position: [8.4, 2.7, 7.5], fov: 31 }}>
      <ambientLight intensity={0.42} />
      <directionalLight castShadow={!mobile} position={[4, 8, 6]} intensity={1.8} shadow-mapSize={[mobile ? 1024 : 2048, mobile ? 1024 : 2048]} shadow-bias={-0.00015} />
      <spotLight position={[-5, 6, 3]} intensity={12} angle={0.5} penumbra={1} />
      <Suspense fallback={<Html center><div className="viewer-loading">Loading the Supra…</div></Html>}>
        <SupraModel selected={[]} />
        <ContactShadows position={[0, 0.015, 0]} opacity={0.38} scale={13} blur={2.4} far={7} resolution={mobile ? 256 : 512} frames={1} color="#3b3b39" />
        <Environment preset="studio" />
      </Suspense>
      <OrbitControls target={[0, 0.8, 0]} enablePan={false} enableZoom={false} minPolarAngle={0.8} maxPolarAngle={1.45} />
    </Canvas>
  );
}

function Viewer({ selected, onToggle, logoUrl, transform, setTransform, checkpoint, locked }) {
  const [dragging, setDragging] = useState(false);
  const [cameraView, setCameraView] = useState("hero");
  const controls = React.useRef();
  const mobile = window.matchMedia("(max-width: 700px)").matches;
  return (
    <>
      <Canvas shadows={!mobile} frameloop="demand" dpr={mobile ? 1 : [1, 1.75]} gl={{ antialias: !mobile, powerPreference: "high-performance" }} camera={{ position: [6.7, 2.8, 7.5], fov: 34 }}>
        <color attach="background" args={["#ededeb"]} />
        <fog attach="fog" args={["#ededeb", 11, 25]} />
        <ambientLight intensity={0.38} />
        <directionalLight castShadow={!mobile} position={[4, 9, 6]} intensity={1.9} shadow-mapSize={[mobile ? 1024 : 2048, mobile ? 1024 : 2048]} shadow-bias={-0.00015} />
        <spotLight castShadow={!mobile} position={[-5, 7, 4]} intensity={12} angle={0.48} penumbra={1} color="#ffffff" />
        <spotLight position={[5, 4, -4]} intensity={8} angle={0.52} penumbra={1} color="#dce8ff" />
        <Suspense fallback={<Html center><div className="viewer-loading">Loading the Supra…</div></Html>}>
          <BrightStudio />
          <SupraPrototype selected={selected} onToggle={onToggle} logoUrl={logoUrl} transform={transform} setTransform={setTransform} setDragging={setDragging} checkpoint={checkpoint} locked={locked} />
          <Environment preset="studio" />
        </Suspense>
        <CameraPreset view={cameraView} controls={controls} />
        <OrbitControls ref={controls} makeDefault enabled={!dragging} target={[0, 0.8, 0]} enablePan={false} minDistance={6} maxDistance={14} minPolarAngle={0.08} maxPolarAngle={1.52} />
      </Canvas>
      <div className="viewer-topbar">
        <span><i /> LIVE 3D</span>
        <div className="camera-switcher" role="group" aria-label="Camera angle">
          {["hero", "front", "side", "top"].map((view) => <button key={view} className={cameraView === view ? "active" : ""} onClick={() => setCameraView(view)}>{view}</button>)}
        </div>
      </div>
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

export default function App() {
  const [selected, setSelected] = useState(["driverDoor-1"]);
  const [logoUrl, setLogoUrl] = useState("");
  const [bakedUrl, setBakedUrl] = useState("");
  const [baking, setBaking] = useState(false);
  const [fileName, setFileName] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [processingLogo, setProcessingLogo] = useState(false);
  const [transform, setTransform] = useState(DEFAULT_TRANSFORM);
  const [pastTransforms, setPastTransforms] = useState([]);
  const [futureTransforms, setFutureTransforms] = useState([]);
  const [bids] = useState(INITIAL_BIDS);
  const [modalOpen, setModalOpen] = useState(false);
  const activePanel = selected.length ? SLOT_MAP[selected[0]].panel : "hood";
  const amount = selected.length ? nextBidForSlots(selected, SLOT_MAP, bids) : 0;
  const renderedLogoUrl = bakedUrl || logoUrl;
  const renderedTransform = bakedUrl ? BAKED_TRANSFORM : transform;

  useEffect(() => () => logoUrl && URL.revokeObjectURL(logoUrl), [logoUrl]);
  useEffect(() => () => bakedUrl && URL.revokeObjectURL(bakedUrl), [bakedUrl]);

  function editPlacement(nextTransform) {
    if (bakedUrl) setBakedUrl("");
    setTransform(nextTransform);
  }

  function checkpoint() {
    setPastTransforms((items) => [...items.slice(-19), { ...transform }]);
    setFutureTransforms([]);
  }

  function undoTransform() {
    if (!pastTransforms.length) return;
    const previous = pastTransforms[pastTransforms.length - 1];
    setPastTransforms((items) => items.slice(0, -1));
    setFutureTransforms((items) => [{ ...transform }, ...items]);
    setTransform(previous);
  }

  function redoTransform() {
    if (!futureTransforms.length) return;
    const next = futureTransforms[0];
    setPastTransforms((items) => [...items, { ...transform }]);
    setFutureTransforms((items) => items.slice(1));
    setTransform(next);
  }

  function toggleSlot(id) {
    const panel = SLOT_MAP[id].panel;
    setBakedUrl("");
    setSelected((current) => {
      if (current.length && SLOT_MAP[current[0]].panel !== panel) return [id];
      if (current.includes(id)) return current.length === 1 ? current : current.filter((slotId) => slotId !== id);
      return [...current, id];
    });
  }

  function choosePanel(panelKey) {
    setBakedUrl("");
    setSelected([PANELS[panelKey].slots[0].id]);
    setTransform(DEFAULT_TRANSFORM);
  }

  async function bakePlacement() {
    if (!logoUrl || !selected.length) return;
    setBaking(true);
    setUploadError("");
    try {
      setBakedUrl(await bakeDecalCanvas(logoUrl, selected, transform));
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
      const processedUrl = await rasterizeAndTrim(file);
      if (logoUrl) URL.revokeObjectURL(logoUrl);
      setBakedUrl("");
      setLogoUrl(processedUrl);
      setFileName(file.name);
      setTransform(DEFAULT_TRANSFORM);
    } catch (error) {
      setUploadError(error.message);
    } finally {
      setProcessingLogo(false);
      event.target.value = "";
    }
  }

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top">BRAND MY SUPRA</a>
        <nav><a href="#studio">3D studio</a><a href="#auction">Bid areas</a><a href="#how">How it works</a></nav>
      </header>

      <section className="hero" id="top">
        <p className="hero-title" aria-label="Your brand on my Supra">YOUR BRAND<br />ON MY<br /><em>SUPRA.</em></p>
        <div className="hero-car"><LandingCar /></div>
        <a className="hero-cta" href="#studio">CUSTOMIZE IT <span>✎</span></a>
        <p className="hero-caption">Twenty sponsor slots. <b>Upload your logo</b>, place it on the Supra, and preview the result in real time.</p>
        <a className="scroll-cue" href="#studio">SCROLL TO CONFIGURE <span>↓</span></a>
      </section>

      <section className="studio-section" id="studio">
        <div className="section-heading">
          <div><p className="eyebrow">3D LOGO STUDIO</p><h2>Make the space yours.</h2></div>
          <p>Rotate the car, select adjacent slots on one panel, then upload and position your logo.</p>
        </div>
        <div className="studio-shell">
          <div className="viewer-wrap">
            <Viewer selected={selected} onToggle={toggleSlot} logoUrl={renderedLogoUrl} transform={renderedTransform} setTransform={editPlacement} checkpoint={checkpoint} locked={Boolean(bakedUrl)} />
            <div className="viewer-hint">{bakedUrl ? "BAKED TO PANEL TEXTURE · SCROLL TO ZOOM" : logoUrl ? "DRAG ON THE BODY TO POSITION · DRAG OUTSIDE IT TO ROTATE · SCROLL TO ZOOM" : "DRAG TO ROTATE · SCROLL TO ZOOM · HOVER TO FIND A SLOT"}</div>
          </div>
          <aside className="controls">
            <div className="rail-header">
              <div><small>LOGO CONFIGURATOR</small><b>{bakedUrl ? "Placement baked" : logoUrl ? "Fine tune" : "Choose placement"}</b></div>
              <div className="history-controls" aria-label="Placement history">
                <button onClick={undoTransform} disabled={!pastTransforms.length} aria-label="Undo placement">↶</button>
                <button onClick={redoTransform} disabled={!futureTransforms.length} aria-label="Redo placement">↷</button>
              </div>
            </div>
            <div className="step-meter" aria-label={logoUrl ? "Step 2 of 2" : "Step 1 of 2"}><i className="complete" /><i className={logoUrl ? "complete" : ""} /></div>
            <div className="control-step"><span>01</span><div><b>Choose an area</b><p>One major panel at a time.</p></div></div>
            <div className="panel-tabs">
              {Object.entries(PANELS).map(([key, panel]) => (
                <button key={key} className={activePanel === key ? "active" : ""} aria-pressed={activePanel === key} onClick={() => choosePanel(key)}>{panel.label}</button>
              ))}
            </div>
            <div className="slot-picker">
              {PANELS[activePanel].slots.map((slot) => (
                <button key={slot.id} className={selected.includes(slot.id) ? "selected" : ""} aria-pressed={selected.includes(slot.id)} onClick={() => toggleSlot(slot.id)}>
                  <b>{slot.label.replace(PANELS[activePanel].label, "").trim()}</b><span>Slot</span><small>{money(bids[slot.id])}</small>
                </button>
              ))}
            </div>
            <button className="text-button" onClick={() => { setBakedUrl(""); setSelected(PANELS[activePanel].slots.map((slot) => slot.id)); }}>Select entire area</button>

            <div className="control-step"><span>02</span><div><b>Upload your logo</b><p>Transparent PNG or SVG works best.</p></div></div>
            <label className="upload-button"><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo} disabled={processingLogo} /><span>{processingLogo ? "Preparing logo…" : fileName || "Choose logo file"}</span><b>＋</b></label>
            {uploadError && <p className="form-error upload-error" role="alert">{uploadError}</p>}

            {logoUrl && <div className="transform-controls tactile-panel">
              {bakedUrl ? <div className="baked-status"><span>✓</span><div><b>Texture baked</b><small>Ready for auction preview</small></div><button type="button" onClick={() => setBakedUrl("")}>Edit</button></div> : <>
                <div className="direct-manipulation"><span>POSITION</span><b>Raycast drag on the body</b></div>
                <label><span>Scale</span><input type="range" min="0.25" max="1" step="0.01" value={transform.scale} onPointerDown={checkpoint} onChange={(event) => editPlacement({ ...transform, scale: Number(event.target.value) })} /><output>{Math.round(transform.scale * 100)}%</output></label>
                <label className="rotation-control"><span>Rotation</span><div className="dial" style={{ "--dial-angle": `${transform.rotation}rad` }}><i /></div><input type="range" min="-3.14" max="3.14" step="0.01" value={transform.rotation} onPointerDown={checkpoint} onChange={(event) => editPlacement({ ...transform, rotation: Number(event.target.value) })} /><output>{Math.round(transform.rotation * 180 / Math.PI)}°</output></label>
                <div className="placement-actions"><button type="button" className="reset-button" onClick={() => { checkpoint(); editPlacement(DEFAULT_TRANSFORM); }}>Reset</button><button type="button" className="bake-button" onClick={bakePlacement} disabled={baking}>{baking ? "Baking…" : "Bake placement"}</button></div>
              </>}
            </div>}
            <div className="selection-summary"><span>{selected.length} slot{selected.length === 1 ? "" : "s"} selected</span><strong>{money(amount)}</strong><small>next combined bid</small></div>
            <button className="primary-button full" onClick={() => setModalOpen(true)}>Place bid <span>→</span></button>
          </aside>
        </div>
      </section>

      <section className="auction-section" id="auction">
        <div className="section-heading"><div><p className="eyebrow">LIVE AUCTION</p><h2>Twenty slots.</h2></div><p>Every slot is a separate auction. Select adjacent slots in the studio for a larger logo.</p></div>
        <div className="auction-list">
          {ALL_SLOTS.map((slot, index) => (
            <article key={slot.id} className="auction-row">
              <span className="slot-number">{String(index + 1).padStart(2, "0")}</span>
              <div><h3>{slot.label}</h3><p>{PANELS[slot.panel].label}</p></div>
              <div className="leader"><small>HELD BY</small><b>OPEN</b></div>
              <div className="current-bid"><small>CURRENT BID</small><b>{money(bids[slot.id])}</b></div>
              <button onClick={() => { setBakedUrl(""); setSelected([slot.id]); document.querySelector("#studio").scrollIntoView({ behavior: "smooth" }); }}>CUSTOMIZE <span>→</span></button>
            </article>
          ))}
        </div>
      </section>

      <section className="how-section" id="how">
        <p className="eyebrow">HOW IT WORKS</p><h2>Three moves.</h2>
        <div className="steps">
          <article><span>01</span><h3>Choose your space</h3><p>Select one slot or combine adjacent slots on the same body panel.</p></article>
          <article><span>02</span><h3>Design it in 3D</h3><p>Upload your logo, rotate the Supra, and tune the placement up close.</p></article>
          <article><span>03</span><h3>Win the auction</h3><p>Winning artwork is reviewed and becomes part of the final livery after the auction.</p></article>
        </div>
      </section>

      <section className="disclaimer">
        <p className="eyebrow">PURCHASE CONDITION</p>
        <p>Winning a sponsorship slot does not guarantee physical installation. Winning logos will be produced and applied to the vehicle only if the organizer completes the purchase of the Toyota GR Supra. If the vehicle is not purchased by the date stated in the final auction terms, winning bidders will be eligible for a refund under those terms.</p>
      </section>

      <footer>
        <a className="wordmark" href="#top">BRAND MY SUPRA</a>
        <p className="model-credit">Preview body is an original stand-in for this studio. The placement grid was built for <a href="https://skfb.ly/oF6Uy" target="_blank" rel="noreferrer">“Toyota Supra MK5 A90”</a> by lbrtwlk, licensed under <a href="http://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noreferrer">Creative Commons Attribution</a>.</p>
        <a href="#top">Back to top ↑</a>
      </footer>
      {modalOpen && <BidModal selected={selected} amount={amount} onClose={() => setModalOpen(false)} />}
    </main>
  );
}

useGLTF.preload("/models/supra.optimized.glb?v=2");

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, GizmoHelper, GizmoViewcube, Html, OrbitControls } from "@react-three/drei";
import React, { Suspense, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import {
  cinemaRefs,
  clamp01,
  easeInOutCubic,
  lerpVectors,
  panelTourFromProgress,
  sceneWeights,
} from "./motion/cinemaState.js";

const HERO_CAM = [8.4, 2.7, 7.5];
const HERO_LOOK = [0, 0.85, 0];
const STUDIO_CAM = [6.7, 2.8, 7.5];
const STUDIO_LOOK = [0, 0.8, 0];
const LOOK = new THREE.Vector3(0, 0.8, 0);

function CinemaDirector({
  carGroup,
  keyLight,
  rimLight,
  fillLight,
  floorRef,
  phase,
  controlsRef,
  cameraView,
  userOrbitingRef,
}) {
  const { camera, invalidate } = useThree();
  const seeded = useRef(false);
  const viewApplied = useRef(cameraView);
  const lookTarget = useRef(new THREE.Vector3(...HERO_LOOK));
  const lastScroll = useRef(-1);

  useEffect(() => {
    if (phase !== "configurator") {
      seeded.current = false;
      return;
    }
    if (seeded.current || !controlsRef.current) return;
    controlsRef.current.target.copy(LOOK);
    controlsRef.current.update();
    seeded.current = true;
  }, [phase, controlsRef]);

  useEffect(() => {
    if (phase !== "configurator" || cameraView === viewApplied.current) return;
    const positions = {
      hero: [6.7, 2.8, 7.5],
      front: [7.8, 1.95, 0],
      side: [0, 2.05, 8.25],
      top: [0.01, 8.7, 0.01],
    };
    camera.position.set(...positions[cameraView]);
    camera.lookAt(LOOK);
    if (controlsRef.current) {
      controlsRef.current.target.copy(LOOK);
      controlsRef.current.update();
    }
    viewApplied.current = cameraView;
    invalidate();
  }, [camera, cameraView, controlsRef, invalidate, phase]);

  useFrame((_, delta) => {
    const target = cinemaRefs.reducedMotion.current ? 1 : cinemaRefs.progress.current;
    cinemaRefs.smoothed.current += (target - cinemaRefs.smoothed.current) * Math.min(1, delta * 4.2);
    const p = cinemaRefs.smoothed.current;
    const weights = sceneWeights(p);
    const tour = panelTourFromProgress(p);

    if (Math.abs(p - lastScroll.current) > 0.003) {
      userOrbitingRef.current = false;
      lastScroll.current = p;
    }

    const freeOrbit = phase === "configurator";
    const holdScrollCam = !freeOrbit && !userOrbitingRef.current;

    if (holdScrollCam) {
      let camPos = HERO_CAM;
      let look = HERO_LOOK;
      let yaw = 0.35;
      let fov = 31;

      if (tour.mode === "brand") {
        const first = tour.next;
        const intro = easeInOutCubic(1 - weights.brand);
        camPos = lerpVectors(HERO_CAM, first.camera, intro * 0.45);
        look = lerpVectors(HERO_LOOK, first.look, intro * 0.45);
        yaw = THREE.MathUtils.lerp(0.35, first.yaw, intro * 0.45);
      } else if (tour.mode === "panel") {
        camPos = lerpVectors(tour.current.camera, tour.next.camera, tour.blend);
        look = lerpVectors(tour.current.look, tour.next.look, tour.blend);
        yaw = THREE.MathUtils.lerp(tour.current.yaw, tour.next.yaw, tour.blend);
        fov = 30;
      } else {
        const last = tour.current;
        const morph = easeInOutCubic(weights.morph);
        camPos = lerpVectors(last.camera, STUDIO_CAM, morph);
        look = lerpVectors(last.look, STUDIO_LOOK, morph);
        yaw = THREE.MathUtils.lerp(last.yaw, -0.12, morph);
        fov = THREE.MathUtils.lerp(30, 34, morph);
      }

      camera.position.lerp(new THREE.Vector3(...camPos), 0.16);
      lookTarget.current.lerp(new THREE.Vector3(...look), 0.16);
      camera.lookAt(lookTarget.current);
      camera.fov = THREE.MathUtils.lerp(camera.fov, fov, 0.12);
      camera.updateProjectionMatrix();

      if (controlsRef.current) {
        controlsRef.current.target.lerp(lookTarget.current, 0.2);
        controlsRef.current.update();
      }

      if (carGroup.current) {
        carGroup.current.rotation.y = THREE.MathUtils.lerp(carGroup.current.rotation.y, yaw, 0.12);
        const scale = THREE.MathUtils.lerp(1, 0.94, easeInOutCubic(weights.morph));
        carGroup.current.scale.setScalar(scale);
      }
    } else if (carGroup.current && (freeOrbit || userOrbitingRef.current)) {
      // Keep car upright while the user orbits; scroll yaw freezes at last value.
      const scale = THREE.MathUtils.lerp(1, 0.94, easeInOutCubic(weights.morph));
      carGroup.current.scale.setScalar(scale);
    }

    if (keyLight.current) {
      keyLight.current.intensity = THREE.MathUtils.lerp(0.55, 0.95, easeInOutCubic(Math.max(weights.panelTour, weights.morph)));
    }
    if (rimLight.current) {
      rimLight.current.intensity = THREE.MathUtils.lerp(18, 26, easeInOutCubic(weights.morph));
    }
    if (fillLight.current) {
      fillLight.current.intensity = THREE.MathUtils.lerp(1.2, 2.4, weights.morph);
    }
    if (floorRef.current) {
      floorRef.current.material.opacity = THREE.MathUtils.lerp(0.78, 0.96, clamp01(weights.panelTour * 0.55 + weights.morph));
      floorRef.current.visible = true;
    }

    if (holdScrollCam || Math.abs(target - cinemaRefs.smoothed.current) > 0.001) invalidate();
  });

  return null;
}

function StudioFloor({ floorRef }) {
  return (
    <group>
      <mesh ref={floorRef} receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.025, 0]}>
        <planeGeometry args={[36, 36]} />
        <meshStandardMaterial
          color="#0c0d10"
          roughness={0.28}
          metalness={0.72}
          transparent
          opacity={0.78}
          envMapIntensity={0.55}
        />
      </mesh>
      {/* Soft horizon cue — LuxAuto-style ground light strip */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.018, -1.2]}>
        <planeGeometry args={[18, 0.55]} />
        <meshBasicMaterial color="#c8ccd4" transparent opacity={0.14} depthWrite={false} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.016, 0.4]}>
        <planeGeometry args={[9, 2.8]} />
        <meshBasicMaterial color="#8a909c" transparent opacity={0.07} depthWrite={false} />
      </mesh>
      <spotLight
        position={[0, 4.2, 1.5]}
        intensity={6}
        angle={0.72}
        penumbra={1}
        distance={14}
        color="#d8dce4"
        castShadow={false}
      />
      <ContactShadows
        position={[0, 0.012, 0]}
        opacity={0.55}
        scale={16}
        blur={3.2}
        far={8}
        resolution={512}
        frames={1}
        color="#050506"
      />
    </group>
  );
}

export default function CinemaCanvas({
  phase,
  children,
  onCursorLabel,
}) {
  const [dragging, setDragging] = useState(false);
  const [cameraView, setCameraView] = useState("hero");
  const [orbitHint, setOrbitHint] = useState(false);
  const controlsRef = useRef();
  const userOrbitingRef = useRef(false);
  const carGroup = useRef();
  const keyLight = useRef();
  const rimLight = useRef();
  const fillLight = useRef();
  const floorRef = useRef();
  const mobile = useMemo(() => window.matchMedia("(max-width: 700px)").matches, []);
  const canEdit = phase === "editing" || phase === "handoff" || phase === "configurator";
  const freeOrbit = phase === "configurator";
  const orbitEnabled = canEdit && !dragging;

  useEffect(() => {
    if (!onCursorLabel) return;
    if (!canEdit) onCursorLabel("");
    else if (dragging) onCursorLabel("DRAG");
    else if (orbitHint || freeOrbit) onCursorLabel("ORBIT");
    else onCursorLabel("PLACE");
  }, [canEdit, dragging, freeOrbit, onCursorLabel, orbitHint]);

  return (
    <>
      <Canvas
        className="cinema-canvas-root"
        shadows={!mobile}
        frameloop="always"
        dpr={mobile ? 1 : [1, 1.75]}
        gl={{ antialias: !mobile, powerPreference: "high-performance", alpha: true, premultipliedAlpha: false }}
        camera={{ position: [8.4, 2.7, 7.5], fov: 31 }}
        onCreated={({ gl }) => {
          gl.setClearColor("#12141a", 0);
          gl.domElement.addEventListener("contextmenu", (event) => event.preventDefault());
        }}
      >
        <fog attach="fog" args={["#12141a", 12, 28]} />
        <ambientLight intensity={0.14} />
        <directionalLight
          ref={keyLight}
          castShadow={!mobile}
          position={[5, 8, 5]}
          intensity={0.65}
          shadow-mapSize={[mobile ? 1024 : 2048, mobile ? 1024 : 2048]}
          shadow-bias={-0.00015}
        />
        {/* Strong rim / back lights — LuxAuto edge definition */}
        <spotLight
          ref={rimLight}
          castShadow={!mobile}
          position={[-6.5, 5.5, -5.5]}
          intensity={20}
          angle={0.55}
          penumbra={0.85}
          distance={28}
          color="#ffffff"
        />
        <spotLight
          position={[4.5, 6.5, -7]}
          intensity={14}
          angle={0.42}
          penumbra={0.9}
          distance={26}
          color="#eef2f8"
        />
        <spotLight
          position={[-2, 9, -2]}
          intensity={8}
          angle={0.35}
          penumbra={1}
          distance={22}
          color="#ffffff"
        />
        <spotLight ref={fillLight} position={[6, 2.8, 3]} intensity={1.4} angle={0.62} penumbra={1} color="#a8b0bc" />
        <Suspense fallback={<Html center><div className="viewer-loading">Loading the Supra…</div></Html>}>
          <StudioFloor floorRef={floorRef} />
          <group ref={carGroup}>{typeof children === "function" ? children(setDragging) : children}</group>
          <Environment preset="city" environmentIntensity={0.35} />
        </Suspense>
        <CinemaDirector
          carGroup={carGroup}
          keyLight={keyLight}
          rimLight={rimLight}
          fillLight={fillLight}
          floorRef={floorRef}
          phase={phase}
          controlsRef={controlsRef}
          cameraView={cameraView}
          userOrbitingRef={userOrbitingRef}
        />
        <OrbitControls
          ref={controlsRef}
          makeDefault
          enabled={orbitEnabled}
          target={[0, 0.8, 0]}
          enablePan={false}
          enableZoom={freeOrbit}
          enableRotate
          minDistance={5.5}
          maxDistance={14}
          minPolarAngle={0.08}
          maxPolarAngle={1.52}
          mouseButtons={{
            LEFT: freeOrbit ? THREE.MOUSE.ROTATE : undefined,
            MIDDLE: THREE.MOUSE.DOLLY,
            RIGHT: THREE.MOUSE.ROTATE,
          }}
          touches={{
            ONE: freeOrbit ? THREE.TOUCH.ROTATE : THREE.TOUCH.DOLLY_PAN,
            TWO: THREE.TOUCH.DOLLY_PAN,
          }}
          onStart={() => {
            userOrbitingRef.current = true;
            setOrbitHint(true);
          }}
          onEnd={() => setOrbitHint(false)}
        />
        {canEdit && (
          <GizmoHelper
            alignment="bottom-left"
            margin={[88, 88]}
            onUpdate={() => {
              userOrbitingRef.current = true;
            }}
          >
            <GizmoViewcube
              color="#1c1d20"
              faces={["Right", "Left", "Top", "Bottom", "Front", "Back"]}
              hoverColor="#e83222"
              textColor="#f4f4f1"
              strokeColor="#0a0a0a"
              opacity={0.92}
            />
          </GizmoHelper>
        )}
      </Canvas>
      <div className={`viewer-topbar ${canEdit ? "is-live" : "is-cinema"}`}>
        <span><i /> {freeOrbit ? "LIVE 3D" : canEdit ? "EDIT PANEL" : "PANEL TOUR"}</span>
        {canEdit && <small className="orbit-hint">RMB rotate · cube snaps view</small>}
        {freeOrbit && (
          <div className="camera-switcher" role="group" aria-label="Camera angle">
            {["hero", "front", "side", "top"].map((view) => (
              <button key={view} className={cameraView === view ? "active" : ""} onClick={() => setCameraView(view)}>{view}</button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

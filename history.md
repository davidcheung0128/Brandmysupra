# History

A running log of what has been done on Brand My Supra. Newest entries are at the top. Update this file when a step lands or is blocked.

## 2026-09-24 — Cinematic scroll studio branch

- Branch: `cursor/cinematic-scroll-studio`
- Lenis + GSAP ScrollTrigger drive a 280vh cinema stage
- One shared R3F canvas: scroll yaws/lights the car, then unlocks the configurator rail
- Custom cursor, magnetic CTAs, reveal text; reduced-motion shortcuts to studio

## 2026-09-24 — Surface-decal / UV-bake studio pass

- Added `src/placement.js` (model-space placement, normal-aligned orientation, coverage ratio, UV density helpers).
- Added `src/logo.js` (trim, alpha convex hull, contour handles, UV atlas bake).
- Rewired `src/App.jsx`: removed rectangular slot planes; panel tint only; raycast drag on painted body; `DecalGeometry` follows surface normal; rotation around normal; throttled rebuild; bake into body-paint `CanvasTexture`; placement kept for edit.
- Checks and production build pass.

## 2026-09-24 — Pushed to GitHub

- Successfully authenticated with GitHub as davidcheung0128
- Pushed branches to https://github.com/davidcheung0128/Brandmysupra:
  - `main` → 4ba1d09892dc388f84fa2b7f5b6fd9f724d97fbc
  - `cursor/surface-decal-uv-bake-03f7` → 4ba1d09892dc388f84fa2b7f5b6fd9f724d97fbc
- Both branches contain the full studio with plan.md and history.md
- GitHub remote now has all committed work, untracked drafts (src/logo.js, src/placement.js, agent-tools/) remain local only

## 2026-09-24 — Tracking files

- Added `plan.md` and `history.md` so the studio plan and the work log live in the repo.

## 2026-09-24 — GitHub push requested, not completed

- Target repository: https://github.com/davidcheung0128/Brandmysupra
- The remote exists and had no branches yet.
- A push of `main` failed in this environment: Git has no GitHub username or token (`could not read Username for 'https://github.com'`). `gh` is not logged in.
- The site is still only on the project remote, at commit `b5bae40` (`Add the Brand My Supra logo studio.`).

## 2026-09-24 — Surface-decal branch started, not finished

- Branch: `cursor/surface-decal-uv-bake-03f7`, created from `b5bae40`.
- Uncommitted drafts only, not wired into the app and not committed:
  - `src/placement.js` stores a placement as panel, model-space surface point, surface normal, panel UV, mesh UV, rotation, scale, and selected slot ids.
  - `src/logo.js` trims transparent padding, builds an alpha convex hull, and drafts a body-paint canvas atlas.
- `src/App.jsx` still uses the earlier projector: panel-aligned `DecalGeometry`, rectangular slot planes, and a panel-local bake preview. It does not import the new modules.

## 2026-09-24 — Studio recovered and pushed to the project remote

- The Codex share [Plan Supra logo customizer](https://chatgpt.com/s/cx_6ab487ca07cc8191a97cd045b1ce179e) had a working site and stopped on "make a github repo and push this website's files."
- Source was rebuilt by replaying that chat's file diffs. `npm run check` and `npm run build` passed.
- Commit `b5bae40` on `main` adds the Vite + React Three Fiber studio:
  - Landing page, "Your brand on my Supra," scroll into the 3D studio.
  - Twenty auction slots across hood, doors, roof, quarters, front bumper, and rear deck.
  - Logo upload (PNG, JPG, WebP, SVG) with transparent padding removed.
  - Drag, scale, rotate, undo/redo, and a bake-preview button.
  - Bid form that rejects personal email domains and accepts a company email. Payments stay off.
  - Purchase disclaimer and Sketchfab attribution.
- Sketchfab's CC BY Supra ([Toyota Supra MK5 A90](https://skfb.ly/oF6Uy) by lbrtwlk) needs a signed-in download, so `public/models/supra.optimized.glb` is an original stand-in on the same placement grid (`npm run model` regenerates it).
- Dev server: http://127.0.0.1:43123

## Earlier — Codex session, before this repo

- Request: replicate https://brand-my-gt3rs.pages.dev/#auction for a white Mk5 Supra, with uploaded logos on the car.
- Decisions recorded in that chat: full auction later, physical decals only if the car is purchased, about twenty slots, visitors reposition the logo, Forza-style 3D view, real payments later.
- Payments were deferred. A company-email gate was requested instead of checkout.
- The GLB was integrated in that session, then the showroom, curved decals, landing page, and a seven-step surface upgrade were described as done there. Those file versions are what `b5bae40` contains.
- That session never created or pushed a repository.

## 2026-09-24 — Sections refit to the real Supra mesh; logo conforms to the paint

- Cause of "bad sections": panel frames were written for the stand-in model, and the GLB is modelled ~7° off its axle line, so slots never sat on the Sketchfab body. The car is now squared to +x (`CAR_YAW` in `src/App.jsx`) and every panel/slot in `src/slots.js` is fitted to measured geometry (car-group space: +x nose, +y up, +z driver side). Slots tile each panel's bounds exactly; outlines follow the wheel arch, nose taper, etc.
- `src/sections.js`: section outlines (draped, numbered, selected slot tinted) and logo clipping both run in a shader in panel space, so the logo is cut exactly at the selected slots' boundary no matter how the surface curves.
- Logo now fits the section (100% scale fills the selected slots), reads upright along the panel's u axis, is lit with the same clearcoat as the paint, and fades where the surface turns away from the projector.
- Fixed: panel picking and pointer hits ignored which side of the car was clicked; a stale "snap" effect could overwrite the placement seeded on a panel change.
- Front/rear/roof/side views were checked with headless Chrome screenshots; rear-deck outline was checked by ray sampling only (tour camera never settled there in headless).

# Plan

Brand My Supra is a browser studio for placing a sponsor logo on a white Toyota GR Supra and previewing a bid. Payments stay off until a later pass. This file is the working plan. `history.md` is the log of what already happened.

## Done

- Landing page and scroll into the 3D logo studio.
- Twenty slots as auction data, with multi-slot selection on one panel.
- Logo upload, trim, drag, scale, rotate, undo/redo.
- Company-email gate. Personal inboxes are rejected. No charge is taken.
- Stand-in Supra GLB, checks, and a production build.
- Site committed on `main` (`b5bae40`) and pushed to the project remote.
- Site is on https://github.com/davidcheung0128/Brandmysupra. `main` and `cursor/surface-decal-uv-bake-03f7` were pushed at `4ba1d09892dc388f84fa2b7f5b6fd9f724d97fbc`, which includes `b5bae40`.
- Surface-normal `DecalGeometry` editing, panel tint (no rectangular slot planes), alpha-contour handles, coverage from slot selection, and UV-atlas bake into body paint.
- CC BY Sketchfab Supra GLB installed as `public/models/supra.optimized.glb`.

## Now

1. Tune panel frames against the Sketchfab mesh if a placement feels off.
2. Improve UV bake where body-paint islands overlap in the atlas.

## Surface decals and UV bake

Branch: `cursor/surface-decal-uv-bake-03f7` (landed on local `main` via `src/placement.js`, `src/logo.js`, and studio rewire).

While editing, project the logo with `DecalGeometry`:

- Raycast the painted body mesh.
- Place the decal on the hit point.
- Align orientation to that triangle’s normal. Rotation is around the normal.
- Keep the decal on one continuous panel.
- Drag with repeated raycasts. Rebuild geometry on pointer release or on a throttle, and dispose the old geometry.

When placement is approved, bake a livery:

- Draw each logo into a transparent canvas matching the car’s UV atlas.
- Use that canvas as a `CanvasTexture` on the body-paint material.
- Keep the placement record so the livery can be edited again.

Slots stay auction data. They should not stay as a grid of planes on the car:

- Choosing a panel tints that body region.
- More selected slots increase the allowed logo coverage.
- After upload, hide the panel tint and show four handles on the logo’s visible contour.
- Clip the decal to the panel mask.
- Trim transparent padding, keep the artwork’s aspect ratio, and use the alpha as the shape.

## Later

- Refine exterior UV islands if multi-winner liveries bleed across panels.
- Stripe deposits at 100% of the bid, refunds for outbid and unsuccessful bidders, and a refund if the Supra is not purchased.
- Accounts, logo approval, and an admin screen.
- Auction close, winner livery on the public car, and the purchase-deadline refund.

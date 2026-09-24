# Plan

Brand My Supra is a browser studio for placing a sponsor logo on a white Toyota GR Supra and previewing a bid. Payments stay off until a later pass. This file is the working plan. `history.md` is the log of what already happened.

## Done

- Landing page and scroll into the 3D logo studio.
- Twenty slots as auction data, with multi-slot selection on one panel.
- Logo upload, trim, drag, scale, rotate, undo/redo.
- Company-email gate. Personal inboxes are rejected. No charge is taken.
- Stand-in Supra GLB, checks, and a production build.
- Site committed on `main` (`b5bae40`) and pushed to the project remote.

## Now

1. Push `main` to https://github.com/davidcheung0128/Brandmysupra.
   This environment has no GitHub credentials, so the push has to be retried with a token or `gh auth login` that can write to `davidcheung0128/Brandmysupra`.
2. Finish the surface-decal work on `cursor/surface-decal-uv-bake-03f7`, then commit it. Draft modules exist and are not hooked up.

## Surface decals and UV bake

Branch: `cursor/surface-decal-uv-bake-03f7`.

While editing, project the logo with `DecalGeometry`:

- Raycast the painted body mesh.
- Place the decal on the hit point.
- Align orientation to that triangle’s normal. Rotation is around the normal.
- Keep the decal on one continuous panel.
- Drag with repeated raycasts. Rebuild geometry on pointer release or on a throttle, and dispose the old geometry.

When placement is approved, bake a livery:

- Draw each logo into a transparent canvas that matches the body UV atlas.
- Use that canvas as a `CanvasTexture` on the body-paint material.
- Keep the placement record so the livery can be edited again.

Placement record, in model space:

```json
{
  "panelMesh": "hood",
  "surfacePoint": [0, 0, 0],
  "surfaceNormal": [0, 1, 0],
  "uvCenter": [0, 0],
  "rotation": 0,
  "scale": 0.8,
  "selectedSlotIds": ["hood-1", "hood-2"],
  "logoAssetId": "..."
}
```

Slots stay auction data. They should not stay as a grid of planes on the car:

- Choosing a panel tints that body mesh.
- More selected slots increase the allowed logo coverage.
- After upload, hide the panel tint and show four handles on the logo’s visible contour.
- Clip the decal to the panel mask.
- Trim transparent padding, keep the artwork’s aspect ratio, and use the alpha as the shape.

UI stays instrument-grade: the car takes most of the viewport, one narrow control rail, one red accent, a rotation dial, a scale track, drag-on-body positioning, and one bid button.

## Later

- Replace `public/models/supra.optimized.glb` with the CC BY Sketchfab model and keep the lbrtwlk attribution. The stand-in does not have a clean non-overlapping exterior UV atlas; the real model needs that before UV baking is trustworthy.
- Stripe deposits at 100% of the bid, refunds for outbid and unsuccessful bidders, and a refund if the Supra is not purchased.
- Accounts, logo approval, and an admin screen.
- Auction close, winner livery on the public car, and the purchase-deadline refund.

# Brand My Supra

A browser studio for placing a sponsor logo on a white Toyota GR Supra and previewing a bid. Visitors pick adjacent slots on one body panel, upload a logo, drag it onto the car, and submit a company email. Payments stay off: a personal inbox is rejected, and a company email is accepted with a note that checkout is not enabled yet.

This is the site from the Plan Supra logo customizer session. That session ended on the request to create a repository and push the website files.

## Run it

```bash
npm install
npm run dev
```

The dev server is [http://127.0.0.1:43123](http://127.0.0.1:43123).

```bash
npm run check
npm run build
```

## Car model

`public/models/supra.optimized.glb` is an original stand-in body, generated to sit on the same placement grid as the studio:

```bash
npm run model
```

The configurator was built around [Toyota Supra MK5 A90](https://skfb.ly/oF6Uy) by lbrtwlk, licensed under [Creative Commons Attribution 4.0](http://creativecommons.org/licenses/by/4.0/). Sketchfab requires a signed-in download. Replace `public/models/supra.optimized.glb` with that GLB to use the licensed model. Keep the attribution.

## What you can do

- Scroll from the landing view into the 3D logo studio.
- Choose a panel, combine slots on that panel, and upload a PNG, JPG, WebP, or SVG.
- Drag the logo on the body, then scale, rotate, undo, or bake the placement.
- Open a slot from the auction list and place a bid. Only a company email gets past the form.

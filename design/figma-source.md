# Figma source

## Kind icons (current)
File: https://www.figma.com/design/gHaBP11DxH2XY163UaVl3U/Untitled?node-id=0-1
The six kind glyphs are 120x120 frames sitting *beside* the `Icons` panel (1:315), not inside it:
`Ticket/event` 1:803, `Meal` 1:761, `flight` 1:779, `Accomodation` 1:770, `Train` 1:783, `Taxi` 1:793.
Exported 18 Sep 2026 into `figma-assets/icons-2026-09-18/`.

They are two-tone line icons (fill #B39DE1, stroke #434343 at 4px). `Icon` renders every SVG as a
CSS mask, so `public/icons/kind/*` drop the fill (mask alpha = the linework) and `public/icons/badge/*`
keep it (mask alpha = a solid silhouette, the only thing legible at 14px). Both are normalised onto a
shared 128x128 square canvas so the set is optically consistent and the edge-centred strokes, which
Figma exports with `overflow="visible"`, do not bleed outside the box.

## Original redesign source (16 Sep)

File: https://www.figma.com/design/iDR4YtZgigRmZXewbojqE9/Untitled?node-id=0-1
Home screen frame: node 1:1478 (symbol `home` 1:575), 402 × 2580.
Assets exported 14 Sep 2026 into `figma-assets/` (Figma's export URLs expire after 7 days).

## Tokens seen in the design
- Coal (bg) #202123 · Card #252525 · Card alt #2A2C2F · Nav #131313 / #000
- Grey 3 #434445 · Grey 4 #5A5B5D · Grey pill #3A3B3D · bg secondary #303133
- Caribbean Green (accent) #11DA8F · Salmon #FF7262 · Banana #FBDD40
- Granny Apple #BDE9C9 · Golden Glow #F8E08E · Columbia Blue #9EE1FE · Coral Candy #F8C1B8
- Type: SF Pro Display (H3 28/1.1 bold, H5 20 bold, Caption 14/16 regular), Inter Bold 15/20 for pills
- Icons: Font Awesome 6 Pro (Light) in the nav — licence needed, otherwise use the exported SVGs
- Radius: cards 8 / 17, pills 9999

## App icon (current)

Home-screen icon = the `App Icon` frame (3:592, 681x681, dotted globe on #202123) in
`gHaBP11DxH2XY163UaVl3U`. Exported 19 Sep 2026 at 4x into `figma-assets/app-icon-2026-09-19/`,
then downscaled with ffmpeg (lanczos, alpha dropped — iOS needs an opaque square) to
`public/icons/apple-touch-icon.png` (180), `icon-192.png` and `icon-512.png`. iOS keeps the old
icon until the app is removed from the Home Screen and re-added.

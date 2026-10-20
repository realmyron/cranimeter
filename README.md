# cranimeter

A clean, browser-based tool for **facial anthropometry**: drop in a photo, place landmarks, and read ratios, angles and proportions like FWHR, the facial index, canthal tilt, the gonial angle, and facial thirds and fifths.

Everything runs locally in your browser. Images are never uploaded.

## Features

- **Add an image** by dragging and dropping it, pasting it (`Ctrl/⌘ V`) or browsing your files.
- **26 preset measurements**, each with guided landmark placement, a reference range and a short explanation:
  - **Proportions:** FWHR, facial index (with Martin–Saller face-type classes), face width/height, midface ratio, eye separation, eye spacing, eye aspect ratio, temple/cheek width, jaw/cheek width, nose/eye gap, mouth/nose width, chin/philtrum, lip ratio
  - **Divisions:** facial thirds, facial fifths, lower third (1 : 2)
  - **Front angles:** canthal tilt (left and right), jaw frontal angle
  - **Profile:** gonial angle, facial convexity, nasofrontal, nasolabial, mentolabial and cervicomental angles, Goode ratio
- **Free tools:** ruler/ratio, angle, tilt (against the horizontal), proportions (any number of points) and scale (calibrate to millimetres, for example with the iris ≈ 11.7 mm).
- **Layers:** each measurement is saved. Click an item to view it, click it again (or click empty space in the panel) to go back to free mode, Shift-click to compare several, or use **Show all**.
- **Points stay editable.** Drag any point to adjust it, or Shift-drag for fine control. A magnifier loupe helps with precise placement.
- **Export** what is on screen as an annotated PNG with a legend, so you can build your own anthropometric chart.
- Light and dark themes, adjustable line colours (presets plus a custom picker), line thickness and label size.
- Counting numbers, draw-in lines, and a "dust" dissolve when a measurement is deleted. Animations can be turned off in Settings.

## Shortcuts

| Key | Action |
| --- | --- |
| `V` `R` `A` `T` `S` `C` | Move, Ruler, Angle, Tilt, Proportions, Scale |
| `Shift` while placing | Snap the line to 0°, 45° or 90° |
| `Shift` + drag a point | Fine adjustment |
| Right-click | Delete a measurement / undo the last point while drawing |
| `Enter` / double-click | Finish a free proportions measurement |
| `Esc` | Cancel the current drawing / deselect |
| `Delete` / `Backspace` | Delete the hovered or focused measurement |
| `Ctrl/⌘ Z`, `Ctrl/⌘ Shift Z` | Undo / redo |
| `F`, `+`, `−`, scroll | Fit, zoom in, zoom out |
| `Space` + drag, middle-drag | Pan |
| `H` | Show all |

## Run it

The site is static (HTML, CSS and JavaScript) with no build step and no dependencies.

- **Locally:** open `index.html` in a browser.
- **GitHub Pages:** push these files to the root of a repository, then go to **Settings → Pages**, choose **Deploy from a branch**, and select `main` / `(root)`. The site will be served at `https://<username>.github.io/<repo>/`.

## Files

```
index.html   markup
style.css    styles (light and dark themes)
app.js       app logic: canvas, tools, animations, export
presets.js   measurement presets, reference ranges and landmark glossary
favicon.svg  icon
```

To add or tune a measurement, edit `presets.js`. Each entry lists its landmarks (`pts`), its kind (`ratio`, `angle`, `tilt` or `segments`), a reference range (`ref`) and the range shown on the bar (`dom`).

## Getting accurate results

- Use a straight-on photo with the camera at eye level and the head level, so there is no roll, pitch or yaw.
- Shoot from 1.5 m or more and zoom in. Close-up phone selfies distort proportions: the nose looks wider and the face narrower.
- Keep a neutral expression with the hair off the forehead so the hairline (trichion) is visible.
- Use true side-profile photos for the profile angles.

## Disclaimer

Reference ranges are approximate norms taken from the facial-anthropometry and aesthetics literature, including Farkas, the Martin–Saller facial index, the neoclassical canons and soft-tissue profile analysis. They vary with sex, age and ancestry, and with how landmarks are placed. Cranimeter is for curiosity and education. It is not a medical or diagnostic tool.

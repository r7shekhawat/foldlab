# Launch kit

Everything you need to ship FoldLab publicly. Realistic goal: a few hundred stars and a credible portfolio piece, more if the demo clip travels.

## Before you post (do these first)

1. **Record the hero GIF** (5 to 8 seconds, under 4 MB): playground at `npm start`, Galaxy Z Fold 7 selected, demo page loaded. Tick "Naive layout" so the viewer sees text crossing the hinge, press **Fold**, then **Unfold**, then untick "Naive layout" so the two-pane layout snaps into place. Save as `docs/demo.gif` and uncomment the image in the README.
2. **Host the playground** on GitHub Pages (the included workflow does it on push to `main`). Put the URL in the repo description and the first line of the README.
3. **Set repo topics:** `foldable`, `devtools`, `chrome-extension`, `responsive-design`, `samsung`, `pixel-fold`, `web-development`.
4. **Add a social preview image** (1280 x 640): the GIF's last frame with the wordmark.
5. **Publish the extension** to the Chrome Web Store (`npm run build:extension`, upload `dist/foldlab-extension.zip`). Review takes days, so submit early. Until then the README's "load unpacked" path works.
6. **Check device data.** Skim `core/devices.json` for the newest devices and fix any CSS px values you can measure on real hardware.

## Product Hunt

- **Name:** FoldLab
- **Tagline (60 chars max):** Chrome DevTools for foldable phones
- **Description (260 chars max):** Test your site on Galaxy Z Fold, Pixel Fold, Surface Duo, iPhone Duo and more. Fold, unfold and half-fold with a real hinge, viewport segments and device posture. Open source, runs in your browser, no account.
- **First comment:** Say who you are and why. Example: "Foldables are mainstream now that Apple has one, but most sites still treat them like big phones. I wanted a way to see the fold, not guess at it. FoldLab has a web playground (paste a URL, press Unfold) and a Chrome extension with real emulation. Device profiles are one JSON file, so PRs for new devices are very welcome."
- **Gallery:** the GIF first, then a screenshot of the all-devices grid, then the extension side panel.
- **Timing:** launch Tuesday to Thursday, 12:01 AM Pacific. Do it after you have a few GitHub stars and two or three people willing to leave honest comments.

## Show HN

- **Title:** Show HN: FoldLab, DevTools for foldable phones (open source)
- **Body:** Three short paragraphs: the problem (sites ignore the fold, Chrome has only a few presets), what it does (fold/unfold animation, hinge, posture, all-devices grid; playground plus extension), and what is honestly limited (websites only, some foldable web APIs sit behind a Chrome flag, a few device sizes are approximate). Ask for corrections to device data.

## Reddit (read each subreddit's self-promotion rules first)

- r/webdev (Showoff Saturday), r/androiddev, r/Frontend, r/SideProject, r/GalaxyFold, r/PixelFold.
- Lead with the GIF and the problem, not the repo link. Ask a question: "What breaks on your fold?"

## X / LinkedIn / Bluesky thread

1. The GIF plus: "I built DevTools for foldables. Paste a URL, press Unfold."
2. The naive layout vs fold-aware layout, side by side.
3. How it works in one paragraph (CDP `displayFeature`, device posture).
4. "Missing your device? It's one JSON object. PRs open." plus the link.

## After launch

- Reply to every issue and PR within a day for the first two weeks.
- Label a handful of `good first issue` items: new device profiles are perfect.
- Write one short post: "What I learned about hinges" (Android `FoldingFeature`, why seamless folds report no segments when flat).

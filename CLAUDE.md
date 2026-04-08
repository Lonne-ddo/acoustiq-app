# AcoustiQ v1.0 — Project Context for Claude Code

## What this is
Environmental acoustic analysis web app for acoustic engineers.
Deployed at: acoustiq-app.pages.dev
Reference framework: Lignes directrices MELCCFP 2026.
Stack: Vite + React 19 + TypeScript 6 + Tailwind CSS 4 + Recharts + SheetJS

## Tab order (current)
Visualisation → Carte → Spectrogramme → Conformité 2026 → Calcul Lw → Concordance → Rapport
(matches the typical workflow: load → look → place on map → check compliance → compute Lw → cross-reference events → generate report)

The Visualisation tab now also embeds a compact, collapsible spectrogram (~200 px) under the chart so users can stay on one screen. The standalone Spectrogramme tab is kept for full-screen analysis with multiple points.

## App version
Injected at build time from `package.json` via Vite `define` (`__APP_VERSION__`). Bump `package.json` to bump the sidebar/header badge.

## Completed features (v1.0)

### Core
- 831C XLSX parser (Summary + Time History sheets, spectra 1/3 octave)
- 821SE parser with auto-detection and heuristic column mapping
- Web Worker parsing for large files (>1 Mo) with progress updates
- Multi-file, multi-point support (6 BV points)
- Drag & drop import (XLSX, WAV, JSON anywhere on sidebar)

### Visualization
- Time series chart with zoom/pan (mouse wheel = zoom on cursor, click+drag = pan, double-click = reset)
- Zoom limits: minimum 2 minutes visible, maximum = full day
- Y axis auto-fits to visible data ±5 dB padding when zoomed
- Sticky per-point labels (top-right overlay) showing live last-visible LAeq value, anchored to right edge
- Zoom level badge ("×n zoom") top-left when zoomed
- Aggregation selector in chart toolbar: 1 s / 5 s / 10 s / 30 s / 1 min / 5 min (default) / 15 min / 1 h. Selection lifted to App and shared with the embedded + full-screen spectrogram. High-resolution warning if 1 s/5 s with > 10 000 raw points.
- **Shift + drag** = time range selection. Popup shows start/end/duration, LAeq and L90 (energy aggregates over the raw data within the selected window) and an "Ajouter comme événement" button. Click outside or press Esc to dismiss.
- **Comparer ON/OFF** button (chart toolbar) → drag once for "Source ON" range (green), drag again for "OFF" range (grey). Result strip below the chart shows ON / OFF / Δ / L_source = 10·log10(10^Lon/10 − 10^Loff/10) plus a confidence badge (green Δ ≥ 3 dB, amber 1–3 dB, rose < 1 dB). "Annuler" exits and clears. Replaces the old time-input ComparisonPanel.
- **Multi-day overlay** — when more than one day is loaded, the date selector becomes a button list. Each non-primary day has a layers icon: click it to overlay that day on the chart (max 1 overlay = 2 days total). Overlay lines are dashed at 55 % opacity, sticky labels read "BV-94 (09 mars)", and the Recharts tooltip shows both days at the hovered time.
- Zoom/pan keyboard shortcuts (+/-, arrows, Space for audio)
- Legend click to toggle individual lines on/off
- Dynamic XAxis tick interval adapting to zoom level
- Min/max decimation downsampling (max 2000 display points)
- Spectrogram 1/3 octave (canvas heatmap, viridis palette) — both embedded under the chart (compact mode, 200 px) and as a standalone Spectrogramme tab. Spectrogram aggregation follows the chart aggregation.
- Spectrogram synchronized with chart zoom state

### Site map (Carte tab)
- Upload a JPG/PNG/WebP image of the site plan (drag & drop or file picker)
- For each assigned point: pick the active point in the toolbar then click on the image to drop a colored marker
- Markers can be dragged to reposition; click a marker to see its current LAeq (computed over the chart's current zoom range, or full day if not zoomed)
- "Réinitialiser les marqueurs" button
- Export PNG of the annotated map (image + colored circles + labels rendered at native resolution via offscreen canvas)
- Marker positions are normalized (fraction 0–1) and persisted in the project save/load JSON via `mapImage` (data URL) and `mapMarkers`

### Analysis
- 6 acoustic indices: LAeq, L10, L50, L90, LAFmax, LAFmin
- Custom time range filtering for indices
- **Périodes MELCCFP** — `IndicesPanel` includes a Ljour / Lsoir / Lnuit table per point (07h–19h / 19h–22h / 22h–07h). Period values are computed via `laeqOnPeriod(data, startH, endH)` (handles the midnight wrap for `Lnuit`). Cells with no data in the period are greyed out and show "—". An info icon explains the MELCCFP 2026 periods. The 3 rows are also appended to the Excel "Indices" sheet.
- **L1..L99 distribution** — compact horizontal bar chart per loaded point at the bottom of `IndicesPanel` (`DistributionSection` / `DistributionMini`). Each mini SVG is 200×120 px, X axis = dB level, Y axis = Lx percentile (1→99 top to bottom). L10/L50/L90 bars are drawn at full opacity with their dB value labelled; the other percentiles are drawn at 45 % opacity. Per-point colour matches the time-series chart. The distribution honours the same time range selector ("Pleine journée" / "Personnalisé") used by the indices table above it. Mini charts are placed in a horizontally scrollable row.
- ON/OFF source comparison with delta and Lsource calculation
- Ambient noise analysis: hourly L90 table + quietest hour
- Conformité 2026 — full compliance check against the Lignes directrices MELCCFP 2026 (Quebec environmental noise guidelines, in effect since 2026-01-13, replaces NI 98-01). Component: `src/components/Conformite2026.tsx`. UX: user picks an HH:MM evaluation hour → `Ba = LAeq` over the [hour, hour+1 h] window for each loaded point. Receptor types I–IV (Tableau 1: 45/40, 50/45, 55/50, 70/70). `Bp` extracted via `extractBp(Ba, Br)` (null if `Ba−Br < 3 dB`). Corrections: `Kt` auto from averaged 1/3-octave spectrum, `Kb` auto from `LCeq` (col 9 of 831C), `Ki` auto from `LAFTeq` proxy = `LAImax` (col 8 of 831C), `Ks` global manual; per-cell manual overrides for Kt/Ki. Helpers `extractBp`, `computeKt`, `computeKb`, `computeKi`, `computeLar1h` in `src/utils/acoustics.ts`. **Note**: per the spec implemented, `LAr,1h = Bp + max(Kt, Ki, Kb, Ks)` (only the highest correction applied — verify against the published guideline if used for legal reporting; ISO 1996 conventionally sums corrections). **Note**: column 8 (`LAImax`) is used as a proxy for `LAFTeq` because the 831C export does not expose `LAFTeq` directly — these are not strictly equivalent.
- Lw power calculation (Q=1 roof, Q=2 ground, ISO 3744 parallelepiped)

### Events & concordance
- Source events with color picker and timestamps
- **Text annotations** — second type in the Events panel (toggle between "Événement" and "Annotation"). An annotation has text + day + time + dB level. Either fill the form and "Ajouter l'annotation", or click the crosshair button to enter placement mode and click directly on the chart (Y snaps to the nearest data point's LAeq). Rendered as a Recharts `ReferenceDot` with a coloured label that lives on the curve (no vertical line). Double-click an annotation in the panel to edit its text inline. Annotations are reset on new project / project switch and are captured by the existing PNG export (html2canvas captures the chart container which contains them). Type: `ChartAnnotation` in `src/types/index.ts`.
- **Détecter événements** button (sidebar Events panel) — runs `detectRisingEvents` over each (point × day) raw stream looking for ≥ 6 dB rises within a sliding 60 s window (deduped within 60 s). Candidates appear as orange dashed reference lines on the chart and as a checklist in the Events panel. Each row has confirm (✓ → becomes a regular SourceEvent in orange `#fb923c`) and dismiss (✗) buttons. Helper lives in `src/utils/acoustics.ts`; types in `CandidateEvent` (`src/types/index.ts`).
- 3-state concordance table (events x points) with CSV export
- Help tooltips on concordance states

### Exports
- PNG chart export (html2canvas, scale 2x, includes legend) **with QR badge** in the bottom-right corner pointing to acoustiq-app.pages.dev (label "AcoustiQ"). Helper: `src/utils/qrBadge.ts` (`drawQrBadge`) — used by both the chart PNG export and the Carte tab PNG export. QR generation uses the `qrcode` npm package.
- Excel indices + raw data export (SheetJS) — includes a "Généré par AcoustiQ — https://acoustiq-app.pages.dev" footer row in the Indices sheet.
- Excel ON/OFF comparison export
- Excel Conformité 2026 export — synthèse sheet has a footer row with the AcoustiQ URL.
- CSV concordance export (UTF-8 BOM)
- Structured text report generator (copy/paste for Word) — auto-fills from loaded data
- Print/PDF export with print-specific CSS

### Rapport (auto-fill)
The Rapport tab pre-fills 6 sections from the live state: header (project, dates, points, file count, company name from settings), methodology (mentions 831C/821SE, 1-second sampling, 5-min aggregation, MELCCFP 2026 corrections Kt/Kb/Ki), conditions météorologiques (from the sidebar Météo section, with the wind validity flag), indices table (LAeq/L10/L50/L90/LAFmax/LAFmin per point), conformité summary (pulled from `Conformite2026` via `onSummaryChange` → App `conformiteSummary` state → `ReportGenerator` prop), and concordance summary (events grouped as "sources identifiées" / "à vérifier" / "non détectés"). Each section has a "Rafraîchir depuis les données" button. Auto-refresh skips sections the user has manually edited (tracked via `lastGeneratedRef`).

### Project management
- Save/load project as JSON (metadata, events, concordance, assignments)
- Multi-project support (editable name, recent projects in localStorage)
- Auto-save current state when switching projects
- **Indices snapshot** — `saveProject` now embeds a per-(point × date) snapshot of the 6 indices (`IndicesSnapshot` in `src/types/index.ts`) so that saved projects can be compared without re-importing raw data. Helper `buildIndicesSnapshot` lives in `src/modules/projectManager.ts`.
- **Comparer projets** — small `GitCompare` button in the sidebar header opens `src/components/ComparisonModal.tsx`. The modal lets the user pick a second `.json` project, parses its `indicesSnapshot`, energetically aggregates current + loaded by point name (`aggregateByPoint`), and renders one comparison table per shared point with `Projet 1 / Projet 2 / Différence (Δ)` columns colour-coded (green if Δ ≤ −0.5, rose if Δ ≥ +0.5, grey otherwise). Excel export available. The modal does **not** touch the current project state; closing it discards the loaded second project.
- **Templates** (sidebar Templates section): save current configuration (point names, conformité receptor, period, Y range) under a name; apply later to pre-fill those fields **without touching loaded files or events**. Stored in `localStorage` (`acoustiq_templates`, max 10 user templates). Two builtins shipped: "Source fixe industrielle" (Type IV, 40–100 dB) and "Résidentiel standard" (Type I, 25–80 dB). Module: `src/modules/templates.ts`. Receptor and period are now lifted to App state (`conformiteReceptor`/`conformitePeriod`) so templates can update them; `Conformite2026.tsx` accepts them as optional controlled props.

### Audio
- WAV file loading via Web Audio API
- Waveform display on canvas
- Play/pause/stop/seek controls
- Time cursor synchronized with chart

### Météo (sidebar Météo section)
- Manual entry of wind speed (km/h, with green/red validity indicator: < 20 km/h = conforme MELCCFP, ≥ 20 km/h = mesures potentiellement invalides), wind direction (N/NE/E/SE/S/SO/O/NO), temperature (°C), conditions (Dégagé/Nuageux/Couvert/Précipitations), and a free note. Component: `src/components/MeteoSection.tsx`. Type: `MeteoData` + `DEFAULT_METEO` in `src/types/index.ts`.
- Persisted in the project save/load JSON via `ProjectData.meteo`. Reset on new project / project switch.
- Included in the Excel export header (top of the Indices sheet) and in the Rapport auto-fill as a dedicated "Conditions météorologiques" section (between Méthodologie and Résultats), with the same auto-refresh + manual-edit detection as other sections.

### Presentation mode
- Fullscreen toggle (⛶ button) in the chart toolbar (next to the export PNG button). Toggles `presentationMode` in App state. Also bound to **F**.
- When active: sidebar hidden, MainPanel header (project name + tabs + global actions) hidden, IndicesPanel hidden, background switches to pure black, and the visible content is forced to the chart tab regardless of `activeTab` (`effectiveTab = presentationMode ? 'chart' : activeTab`).
- The chart toolbar (day selector, aggregation selector, zoom controls, PNG export) and the embedded spectrogram remain available and synced. A title overlay at the top of the chart shows the project name + assigned points + selected date.
- Press **Esc** or click the toggle again to exit. The Esc handler in `App.tsx` closes modals and exits presentation mode in the same callback.

### UX/DX
- Onboarding flow (3-step welcome modal on first visit)
- Settings panel (point colors, Y axis, aggregation, company name, FR/EN)
- Full i18n system (FR/EN toggle, ~70 translation keys)
- Collapsible sidebar with localStorage persistence
- File cards with color-coded borders, grouped by date
- Toast notification system (success/error/info)
- Keyboard shortcuts: **Space** (audio play/pause), **← →** (pan), **+ −** (zoom), **R** (reset zoom), **F** (toggle presentation mode), **D** (auto-detect events), **Ctrl+S** (save), **Ctrl+O** (open), **Esc** (exit current mode/modal). Listed in `ShortcutsModal.tsx` and triggered by the global `keydown` handler in `App.tsx`.
- Shortcuts help modal
- Tab transition animations
- Accessibility: aria-labels, aria-current, tab order

## Data flow
1. User drops/selects XLSX file(s)
2. Files >1Mo → Web Worker (parserWorker.ts), else main thread (parseFile)
3. Parser chain: detect821SE() → parse821SE, else parse831C → fallback parse821SE
4. Parsed MeasurementFile[] added to React state (dedup by name+date)
5. User assigns point (BV-xx) via dropdown → pointMap state
6. Chart/Indices/Spectrogram filter by selectedDate + pointMap
7. Aggregation: raw DataPoint[] → 5-min (configurable) buckets → ChartEntry[]
8. Display: Recharts LineChart with min/max decimation for >2000 points

## Key technical notes
- All acoustic calculations are energetic (log10 domain)
- Percentiles use ascending sort: L90 (low) <= L50 <= L10 (high)
- Times stored as minutes since midnight (0-1440), modulo 1440 for midnight wrap
- Spectra: 27 bands (6.3 Hz - 20 kHz), aligned with FREQ_BANDS_ALL[-27:]
- No external backend — 100% client-side, localStorage only

## Known limitations
- No undo/redo system
- Audio file must be loaded manually (no auto-association with measurement)
- Spectrogram not yet interactive (no click-to-zoom)
- Bundle size ~413 kB gzip (XLSX + Recharts + qrcode are the heaviest dependencies — well under the 2 MB target)
- No .wav analysis (only playback, no LAeq from audio)
- Project save does not include raw measurement data (files must be re-imported)

## Environment
- No environment variables required
- No backend, no API keys
- Deploy: npm run build → dist/ to any static host (Cloudflare Pages)

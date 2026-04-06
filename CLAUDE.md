# AcoustiQ — Project Context for Claude Code

## What this is
Environmental acoustic analysis web app for acoustic engineers.
Deployed at: acoustiq-app.pages.dev
Stack: Vite + React + TypeScript + Tailwind + Recharts + SheetJS

## Current state (v0.1)
- 831C XLSX parser working (Summary + Time History sheets)
- Time series chart with multi-point support
- Acoustic indices panel (LAeq, L10, L50, L90, LAFmax, LAFmin)
- Source events with color picker
- Concordance table (events × points, 3-state, CSV export)

## Next features to build (v0.2)
- Spectrogram view (frequency × time heatmap from 1/3 octave data)
- Lw calculation module (Q=1 roof, Q=2 ground, ISO 3744 mobile)
- Audio .wav file loading + waveform display
- Export: PNG chart, Excel indices report
- 821SE parser (SoundExpert format)

## Key technical notes
- 831C Time Histor
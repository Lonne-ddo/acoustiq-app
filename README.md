# AcoustiQ

Outil d'analyse acoustique environnementale pour les sonomètres SoundAdvisor 831C et SoundExpert 821SE.

**100 % client-side** — aucun backend, aucune donnée envoyée vers un serveur.

## Fonctionnalités

| Module | Description |
|--------|-------------|
| **Parsers** | Lecture XLSX 831C et 821SE avec auto-detection, Web Worker pour les gros fichiers |
| **Visualisation** | Courbes LAeq multi-points, zoom/pan, légende interactive |
| **Spectrogramme** | Heatmap 1/3 octave (canvas, palette viridis), synchronisé avec le zoom |
| **Indices** | LAeq, L10, L50, L90, LAFmax, LAFmin avec plage horaire personnalisable |
| **Comparaison ON/OFF** | Isolation de la contribution source avec calcul de Lsource et confiance |
| **REAFIE** | Conformité réglementaire par zone (résidentiel/commercial/industriel) |
| **Bruit de fond** | L90 horaire, identification de l'heure la plus calme |
| **Lw** | Puissance acoustique (Q=1 toiture, Q=2 sol, ISO 3744) |
| **Concordance** | Matrice événements x points, 3 états, export CSV |
| **Rapport** | Générateur de rapport structuré, copier/coller, export .txt et PDF |
| **Audio** | Lecture WAV, forme d'onde, curseur synchronisé |
| **Projet** | Sauvegarde/chargement JSON, projets récents |

## Stack technique

- **Vite** + **React 19** + **TypeScript 6** + **Tailwind CSS 4**
- **Recharts** — graphiques
- **SheetJS** (xlsx) — lecture des fichiers XLSX
- **html2canvas** — export PNG
- **lucide-react** — icones
- **Web Audio API** — lecture .wav

## Lancer en local

```bash
npm install
npm run dev
```

L'application est disponible sur `http://localhost:5173`.

## Build de production

```bash
npm run build
```

Le dossier `dist/` contient le build statique optimise.

## Deployer sur Cloudflare Pages

1. Connecter le repo GitHub a Cloudflare Pages
2. Build command : `npm run build`
3. Build output directory : `dist`
4. L'application est deployee automatiquement a chaque push sur `main`

Ou manuellement :

```bash
npx wrangler pages deploy dist --project-name=acoustiq-app
```

## Formats de fichiers supportes

| Appareil | Format | Feuilles |
|----------|--------|----------|
| SoundAdvisor 831C | .xlsx | Summary + Time History (colonnes 2, 4, 41-67) |
| SoundExpert 821SE | .xlsx | Summary + Time History (detection heuristique) |

## Indices acoustiques

| Indice | Description |
|--------|-------------|
| LAeq | Niveau equivalent continu (moyenne energetique) |
| L10 | Niveau depasse 10% du temps (pointes) |
| L50 | Niveau median |
| L90 | Niveau depasse 90% du temps (bruit residuel) |
| LAFmax | Niveau max instantane |
| LAFmin | Niveau min instantane |
| Lw | Puissance acoustique |

## Licence

Projet prive.

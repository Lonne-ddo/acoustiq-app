# AcoustiQ

Outil d'analyse acoustique environnementale pour ingénieurs du son.

## Description

AcoustiQ permet de lire les fichiers de mesure issus de sonomètres de terrain (SoundAdvisor 831C, SoundExpert 821SE), de visualiser les courbes de niveaux sonores, de calculer des indices acoustiques réglementaires (LAeq, L10, L50, L90) et d'identifier des événements de sources de bruit.

## Stack technique

- **Vite + React + TypeScript** — build rapide, typage strict
- **Tailwind CSS v4** — styles utilitaires
- **SheetJS (xlsx)** — lecture des fichiers XLSX des sonomètres
- **lucide-react** — icônes
- **100 % client-side** — aucun backend, aucune base de données

## Déploiement

Cible : **Cloudflare Pages** (export statique)

```bash
npm run build
# Déployer le dossier dist/ sur Cloudflare Pages
```

## Structure du projet

```
src/
  components/     # Composants UI réutilisables
  modules/        # Modules fonctionnels (parsers, calculs, événements)
  types/          # Interfaces TypeScript
  utils/          # Utilitaires de calcul acoustique
  App.tsx
  main.tsx
```

## Développement local

```bash
npm install
npm run dev
```

## Formats de fichiers supportés

| Appareil           | Format  | Feuille Summary | Feuille Time History |
|--------------------|---------|-----------------|----------------------|
| SoundAdvisor 831C  | .xlsx   | Oui             | Oui (colonnes 2, 4, 41+) |
| SoundExpert 821SE  | .xlsx   | À venir         | À venir              |

## Indices acoustiques calculés

| Indice | Description |
|--------|-------------|
| LAeq   | Niveau équivalent continu (moyenne énergétique) |
| L10    | Niveau dépassé 10 % du temps (bruit de pointe) |
| L50    | Niveau médian |
| L90    | Niveau dépassé 90 % du temps (bruit résiduel) |
| Lw     | Puissance acoustique (champ libre sphérique) |

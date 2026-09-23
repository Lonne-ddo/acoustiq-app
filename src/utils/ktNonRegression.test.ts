import { describe, it, expect } from 'vitest'
import { analyzeKt, analyzeKt9801, KT_BAND_FREQS } from './acoustics'

/**
 * NON-RÉGRESSION de `analyzeKt` face à la version de `main` qui indexait les
 * bandes PAR INDEX (`spectrum[i]` ↔ `KT_BAND_FREQS[i]`).
 *
 * Kt est une correction RÉGLEMENTAIRE (MELCCFP 2026, §3.7.4) : changer la façon
 * dont les bandes sont adressées change un résultat opposable. Ce fichier fige
 * le comportement HÉRITÉ, pour que le passage à l’indexation par fréquence soit
 * démontrablement sans effet là où l’ancienne version savait déjà calculer.
 *
 * POURQUOI DES SPECTRES SYNTHÉTIQUES. `main` refuse tout spectre dont les
 * fréquences ne se superposent pas à `KT_BAND_FREQS` dès la 1ʳᵉ bande. Aucun
 * fichier de mesure réel disponible n’y parvient : les exports 831C/821SE à
 * bandes nommées démarrent à 6,3 Hz. Le SEUL format que `main` sait calculer
 * est le bloc POSITIONNEL 831C — 27 bandes de 50 Hz à 20 kHz
 * (`SE831C_FREQ_BANDS`, formatDetectors.ts:35-39), et ses préfixes. C’est donc
 * le format de tous les cas ci-dessous : comparer sur autre chose n’aurait
 * comparé qu’un refus à un calcul.
 *
 * LE CAS (f) A RÉVÉLÉ UNE RÉGRESSION, depuis corrigée. Un spectre ÉCOURTÉ —
 * préfixe contigu depuis 50 Hz, sans trou — était calculé par `main` et
 * produisait un Kt légitime : chaque bande y est lue avec le bon seuil et la
 * bonne pondération, seule la dernière devient bande de bord. La première
 * version de cette branche le refusait, retirant un résultat valide. Le
 * critère de PRÉFIXE CONTIGU (`ktLevelsByFrequency`) rétablit ce calcul sans
 * rouvrir la porte aux spectres TROUÉS, qui restent refusés — cas (g).
 *
 * PROVENANCE DES GOLDEN. Valeurs produites par l’`analyzeKt` (`golden`) et
 * l’`analyzeKt9801` (`golden9801`) de `main` (f8035d0), extraites par
 * `git show` dans un harnais temporaire hors du dépôt, exécutées sur ces
 * entrées exactes. Égalité STRICTE constatée sur les 9 cas calculés, pour
 * chacune des deux fonctions : `kt`, `triggeringIndex` et toutes les
 * `KtBandRow`, champ par champ, sans tolérance. Le 10ᵉ cas (spectre troué,
 * (g)) est un refus sur la branche, testé à part. Les littéraux sont recopiés
 * à pleine précision — le bruit flottant visible (p. ex. 43.800000000000004)
 * est la valeur RÉELLE de `main`, pas une coquille : l’arrondir relâcherait le
 * critère.
 *
 * UN SEUL ÉCART VOULU avec `main`, corrigé à la main : `golden9801.threshold`
 * à 160 Hz (index 5) vaut 8, et non 15 comme le rendait `main`. `main`
 * appliquait à tort 15 dB à 160 Hz en 98-01 ; la Note 98-01, annexe IV,
 * Tableau 4, donne 8 dB de 160 à 400 Hz, comme le Tableau 2 de 2026. Dans les
 * 9 cas, aucun Δ à 160 Hz n’atteint 8 : ni `isTonal` ni `kt` ne bougent. Tout
 * le reste est la sortie de `main`, inchangée.
 *
 * NE PAS régénérer ces golden depuis le code courant. Un golden recalculé à
 * partir de ce qu’on teste ne prouve plus rien.
 */

/** Bloc positionnel 831C — 27 bandes. `SE831C_FREQ_BANDS`, formatDetectors.ts:35-39. */
const FREQS_831C = [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000]

/** Spectre plat à `base` dB sur `freqs`, avec des pics { fréquence: niveau }. */
function spectre(freqs: number[], base: number, pics: Record<number, number> = {}): number[] {
  return freqs.map((f) => (f in pics ? pics[f] : base))
}

/** Booléens des bandes, encodés en chaîne lisible : X = vrai, . = faux. */
const flags = (v: boolean[]): string => v.map((b) => (b ? 'X' : '.')).join('')

/** Sortie de référence d’une analyse, aplatie colonne par colonne. */
interface GoldenBandes {
  kt: number
  triggeringIndex: number | null
  triggeringFreq: number | null
  freq: number[]
  lzeq: number[]
  laeqBand: number[]
  diffPrev: (number | null)[]
  diffNext: (number | null)[]
  threshold: number[]
  isBoundary: string
  excluded: string
  isTonal: string
}

interface CasNonRegression {
  id: string
  titre: string
  note: string
  freqs: number[]
  base: number
  pics: Record<number, number>
  ba: number
  /** Produit par analyzeKt de main (cadre MELCCFP 2026). */
  golden: GoldenBandes
  /** Produit par analyzeKt9801 de main sur la MÊME entrée (cadre Note 98-01). */
  golden9801: GoldenBandes
}

const CAS: CasNonRegression[] = [
  {
    id: "a-plat",
    titre: "(a) spectre plat — aucune émergence",
    note:
      "Les bandes graves sont tout de même exclues (Ba − LAeq_bande ≥ 15) : le champ `excluded` est donc exercé par ce cas, pas seulement `isTonal`.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 60,
    pics: {},
    ba: 55,
    golden: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60],
      laeqBand: [29.8,33.8,37.5,40.9,43.9,46.6,49.1,51.4,53.4,55.2,56.8,58.1,59.2,60,60.6,61,61.2,61.3,61.2,61,60.5,59.9,58.9,57.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXX.....................',
      isTonal: '........................',
    },
    golden9801: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60,60],
      laeqBand: [29.8,33.8,37.5,40.9,43.9,46.6,49.1,51.4,53.4,55.2,56.8,58.1,59.2,60,60.6,61,61.2,61.3,61.2,61,60.5,59.9,58.9,57.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXX.....................',
      isTonal: '........................',
    },
  },
  {
    id: "b-tonalite-franche",
    titre: "(b) tonalité franche — 1000 Hz à 70 dB sur fond 50 dB",
    note:
      "Δprec = Δsuiv = 20 dB ≫ seuil 5 dB. LAeq_bande = 70,0 ⇒ non exclue. PREUVE VIVE : si la détection était morte, ce cas tomberait à 0 et l'égalité stricte avec main masquerait la panne.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"1000":70},
    ba: 55,
    golden: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,70,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,70,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,20,-20,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-20,20,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '.............X..........',
    },
    golden9801: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,70,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,70,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,20,-20,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-20,20,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '.............X..........',
    },
  },
  {
    id: "c1-limite-egale-au-seuil",
    titre: "(c1) limite de critère — Δ = 5,0 dB exactement = seuil",
    note:
      "Le test est `>=` : Δ égal au seuil DÉCLENCHE. 55,0 et 50,0 sont exacts en binaire, Δ vaut 5 sans bruit flottant.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"1000":55},
    ba: 55,
    golden: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,55,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,55,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,5,-5,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-5,5,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '.............X..........',
    },
    golden9801: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,55,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,55,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,5,-5,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-5,5,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '.............X..........',
    },
  },
  {
    id: "c2-limite-sous-le-seuil",
    titre: "(c2) limite de critère — Δ = 4,5 dB, juste sous le seuil",
    note:
      "Même bande, même seuil, verdict inverse : encadre le seuil des deux côtés.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"1000":54.5},
    ba: 55,
    golden: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,54.5,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,54.5,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,4.5,-4.5,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-4.5,4.5,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '........................',
    },
    golden9801: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,54.5,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,54.5,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,4.5,-4.5,0,0,0,0,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-4.5,4.5,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '........................',
    },
  },
  {
    id: "d1-bord-50Hz",
    titre: "(d1) INVARIANT DE BORD — 50 Hz à 80 dB : émergence énorme, jamais tonale",
    note:
      "50 Hz est la PREMIÈRE bande d’analyse ⇒ diffPrev = null ⇒ isBoundary ⇒ isTonal faux par construction, quelle que soit l’émergence. Ce cas ne teste PAS la détection : il fige l’invariant de bord.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"50":80},
    ba: 55,
    golden: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [80,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [49.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,-30,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [30,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: '.XXXXXX.................',
      isTonal: '........................',
    },
    golden9801: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [80,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [49.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,-30,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [30,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: '.XXXXXX.................',
      isTonal: '........................',
    },
  },
  {
    id: "d2-bord-10kHz",
    titre: "(d2) INVARIANT DE BORD — 10 kHz à 80 dB : idem en haut de plage",
    note:
      "10 kHz est la DERNIÈRE bande d’analyse ⇒ diffNext = null, alors même que spectrum[24] = 12,5 kHz EXISTE dans le spectre. main pose aussi diffNext = null à i = N−1 : l’invariant est commun aux deux versions.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"10000":80},
    ba: 55,
    golden: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,80],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,77.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,30],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-30,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '........................',
    },
    golden9801: {
      kt: 0,
      triggeringIndex: null,
      triggeringFreq: null,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,80],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,77.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,30],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-30,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '........................',
    },
  },
  {
    id: "e1-premiere-bande-evaluable-63Hz",
    titre: "(e1) 63 Hz à 70 dB — première bande réellement évaluable, EN BAS",
    note:
      "Seuil 15 dB (fc ≤ 125). Δprec = Δsuiv = 20 ≥ 15 ⇒ tonal. LAeq_bande = 70 − 26,2 = 43,8 ; Ba − 43,8 = 11,2 < 15 ⇒ NON exclue. ATTRAPE UN DÉCALAGE D'UN CRAN : à −1 cran la bande serait lue comme 50 Hz (bord ⇒ kt 0), à +1 cran comme 80 Hz (Δ recalculés ⇒ kt 0).",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"63":70},
    ba: 55,
    golden: {
      kt: 5,
      triggeringIndex: 1,
      triggeringFreq: 63,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,70,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,43.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,20,-20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [-20,20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'X.XXXXX.................',
      isTonal: '.X......................',
    },
    golden9801: {
      kt: 5,
      triggeringIndex: 1,
      triggeringFreq: 63,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,70,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50],
      laeqBand: [19.8,43.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,48.9,47.5],
      diffPrev: [null,20,-20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],
      diffNext: [-20,20,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'X.XXXXX.................',
      isTonal: '.X......................',
    },
  },
  {
    id: "e2-premiere-bande-evaluable-8kHz",
    titre: "(e2) 8 kHz à 70 dB — première bande réellement évaluable, EN HAUT",
    note:
      "Seuil 5 dB. Δprec = Δsuiv = 20 ⇒ tonal. LAeq_bande = 68,9 ⇒ non exclue. Symétrique de (e1) : un décalage d’un cran basculerait sur 10 kHz (bord ⇒ kt 0).",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000,12500,16000,20000],
    base: 50,
    pics: {"8000":70},
    ba: 55,
    golden: {
      kt: 5,
      triggeringIndex: 22,
      triggeringFreq: 8000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,70,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,68.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,20,-20],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-20,20,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '......................X.',
    },
    golden9801: {
      kt: 5,
      triggeringIndex: 22,
      triggeringFreq: 8000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000,5000,6300,8000,10000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,50,70,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,50,50.6,51,51.2,51.3,51.2,51,50.5,49.9,68.9,47.5],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,20,-20],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,-20,20,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X......................X',
      excluded: 'XXXXXXX.................',
      isTonal: '......................X.',
    },
  },
  {
    id: "f-prefixe-contigu-20-bandes",
    titre: "(f) PRÉFIXE CONTIGU — 20 bandes 50 Hz – 4 kHz, tonalité à 1 kHz",
    note:
      "Spectre ÉCOURTÉ, pas troué : la couverture démarre à 50 Hz et s’arrête à 4 kHz sans manque. main calculait ce cas (N = min(24, 20) = 20) et rendait un Kt légitime ; la branche le refusait — c’était une RÉGRESSION, corrigée par le critère de préfixe contigu. 4 kHz, dernière bande couverte, devient bande de bord faute de voisine haute.",
    freqs: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000],
    base: 50,
    pics: {"1000":70},
    ba: 55,
    golden: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,70,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,70,50.6,51,51.2,51.3,51.2,51],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,20,-20,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-20,20,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X..................X',
      excluded: 'XXXXXXX.............',
      isTonal: '.............X......',
    },
    golden9801: {
      kt: 5,
      triggeringIndex: 13,
      triggeringFreq: 1000,
      freq: [50,63,80,100,125,160,200,250,315,400,500,630,800,1000,1250,1600,2000,2500,3150,4000],
      lzeq: [50,50,50,50,50,50,50,50,50,50,50,50,50,70,50,50,50,50,50,50],
      laeqBand: [19.8,23.8,27.5,30.9,33.9,36.6,39.1,41.4,43.4,45.2,46.8,48.1,49.2,70,50.6,51,51.2,51.3,51.2,51],
      diffPrev: [null,0,0,0,0,0,0,0,0,0,0,0,0,20,-20,0,0,0,0,0],
      diffNext: [0,0,0,0,0,0,0,0,0,0,0,0,-20,20,0,0,0,0,0,null],
      threshold: [15,15,15,15,15,8,8,8,8,8,5,5,5,5,5,5,5,5,5,5],
      isBoundary: 'X..................X',
      excluded: 'XXXXXXX.............',
      isTonal: '.............X......',
    },
  },
]

describe('analyzeKt — non-régression stricte vs main (indexation par index)', () => {
  for (const c of CAS) {
    it(c.titre, () => {
      const spectrum = spectre(c.freqs, c.base, c.pics)
      const r = analyzeKt(spectrum, c.ba, c.freqs)

      // Un refus rendrait toutes les assertions suivantes vides de sens : on le
      // barre d’abord, explicitement, plutôt que de le laisser passer en creux.
      expect(r.unavailable).toBeNull()
      expect(r.bands.map((b) => b.freq)).toEqual(c.golden.freq)

      expect(r.kt).toBe(c.golden.kt)
      expect(r.triggeringIndex).toBe(c.golden.triggeringIndex)
      // La fréquence, pas seulement l’index : l’index n’est qu’un encodage, et
      // c’est précisément l’encodage que cette branche a changé.
      const fT = r.triggeringIndex === null ? null : r.bands[r.triggeringIndex].freq
      expect(fT).toBe(c.golden.triggeringFreq)

      expect(r.bands.map((b) => b.lzeq)).toEqual(c.golden.lzeq)
      expect(r.bands.map((b) => b.laeqBand)).toEqual(c.golden.laeqBand)
      expect(r.bands.map((b) => b.diffPrev)).toEqual(c.golden.diffPrev)
      expect(r.bands.map((b) => b.diffNext)).toEqual(c.golden.diffNext)
      expect(r.bands.map((b) => b.threshold)).toEqual(c.golden.threshold)
      expect(flags(r.bands.map((b) => b.isBoundary))).toBe(c.golden.isBoundary)
      expect(flags(r.bands.map((b) => b.excluded))).toBe(c.golden.excluded)
      expect(flags(r.bands.map((b) => b.isTonal))).toBe(c.golden.isTonal)
    })
  }

  it('(b) PREUVE VIVE : la détection produit bien un Kt non nul', () => {
    // Sans cette assertion, un détecteur rendant toujours 0 satisferait quand
    // même l’égalité stricte ci-dessus — main rendrait 0 lui aussi. L’égalité
    // prouve l’absence de dérive ; seul ce cas prouve qu’il reste quelque chose
    // à ne pas faire dériver.
    const r = analyzeKt(spectre(FREQS_831C, 50, { 1000: 70 }), 55, FREQS_831C)
    expect(r.unavailable).toBeNull()
    expect(r.kt).toBe(5)
    expect(r.bands[r.triggeringIndex as number].freq).toBe(1000)
  })

  it('(d) INVARIANT DE BORD : 50 Hz et 10 kHz ne peuvent JAMAIS être tonales', () => {
    // Bandes extrêmes de la plage d’analyse : un Δ leur manque, donc isBoundary,
    // donc isTonal faux quelle que soit l’émergence. Vrai sur main comme ici.
    for (const f of [KT_BAND_FREQS[0], KT_BAND_FREQS[KT_BAND_FREQS.length - 1]]) {
      const r = analyzeKt(spectre(FREQS_831C, 50, { [f]: 90 }), 55, FREQS_831C)
      const b = r.bands[KT_BAND_FREQS.indexOf(f)]
      expect(b.isBoundary).toBe(true)
      expect(b.isTonal).toBe(false)
      expect(r.kt).toBe(0)
    }
  })

  it('(f) la dernière bande d’un préfixe écourté est bande de bord', () => {
    // Corollaire du critère de préfixe contigu : faute de voisine haute, 4 kHz
    // ne peut pas être tonale — exactement comme 10 kHz sur un spectre complet.
    const freqs = KT_BAND_FREQS.slice(0, 20)
    const r = analyzeKt(spectre(freqs, 50, { 1000: 70 }), 55, freqs)
    expect(r.unavailable).toBeNull()
    expect(r.bands).toHaveLength(20)
    const derniere = r.bands[19]
    expect(derniere.freq).toBe(4000)
    expect(derniere.isBoundary).toBe(true)
    expect(derniere.diffNext).toBeNull()
    expect(derniere.isTonal).toBe(false)
  })
})

/**
 * MÊME golden sur le cadre 98-01. `analyzeKt9801` partage `ktLevelsByFrequency`
 * avec le cadre 2026 : le critère de préfixe contigu le traverse, et sa boucle a
 * dû passer de `KT_BAND_FREQS.length` à `levels.length` — sans quoi un spectre
 * écourté aurait produit des `NaN` silencieux. Rien ne couvrait cette fonction
 * sur une couverture partielle : les tests existants (acoustics.test.ts:331-360,
 * ktAlignment.test.ts:172-186) travaillent tous sur 24 bandes complètes.
 *
 * Les seuils sont ceux du cadre 2026 (même `ktThreshold`) ; seule l’exclusion
 * diffère (> 14,5 au lieu de >= 15). Sur ces 9 cas, aucune bande ne tombe dans
 * ]14,5 ; 15[ : `golden9801` coïncide donc avec `golden`. Ils restent écrits
 * séparément pour qu’une future divergence des deux cadres soit visible.
 */
describe('analyzeKt9801 — non-régression stricte vs main (cadre 98-01)', () => {
  for (const c of CAS) {
    it(c.titre, () => {
      const spectrum = spectre(c.freqs, c.base, c.pics)
      const r = analyzeKt9801(spectrum, c.ba, c.freqs)
      const g = c.golden9801

      expect(r.unavailable).toBeNull()
      expect(r.bands.map((b) => b.freq)).toEqual(g.freq)
      expect(r.kt).toBe(g.kt)
      expect(r.triggeringIndex).toBe(g.triggeringIndex)
      const fT = r.triggeringIndex === null ? null : r.bands[r.triggeringIndex].freq
      expect(fT).toBe(g.triggeringFreq)

      expect(r.bands.map((b) => b.lzeq)).toEqual(g.lzeq)
      expect(r.bands.map((b) => b.laeqBand)).toEqual(g.laeqBand)
      expect(r.bands.map((b) => b.diffPrev)).toEqual(g.diffPrev)
      expect(r.bands.map((b) => b.diffNext)).toEqual(g.diffNext)
      expect(r.bands.map((b) => b.threshold)).toEqual(g.threshold)
      expect(flags(r.bands.map((b) => b.isBoundary))).toBe(g.isBoundary)
      expect(flags(r.bands.map((b) => b.excluded))).toBe(g.excluded)
      expect(flags(r.bands.map((b) => b.isTonal))).toBe(g.isTonal)
    })
  }

  it('(f) préfixe écourté : 20 bandes, pas de NaN, 4 kHz en bande de bord', () => {
    // La régression qu’aurait produite un N figé à 24 : levels[20] undefined,
    // laeqBand = NaN, et un verdict rendu sur des valeurs qui ne sont pas des nombres.
    const freqs = KT_BAND_FREQS.slice(0, 20)
    const r = analyzeKt9801(spectre(freqs, 50, { 1000: 70 }), 55, freqs)
    expect(r.unavailable).toBeNull()
    expect(r.bands).toHaveLength(20)
    expect(r.bands.every((b) => Number.isFinite(b.lzeq) && Number.isFinite(b.laeqBand))).toBe(true)
    expect(r.bands[19].freq).toBe(4000)
    expect(r.bands[19].isBoundary).toBe(true)
    expect(r.kt).toBe(5)
  })

  it('(g) spectre troué → bande-analyse-absente, comme le cadre 2026', () => {
    const freqs = FREQS_831C.filter((f) => f !== 1000)
    const r = analyzeKt9801(spectre(freqs, 50, { 1250: 70 }), 55, freqs)
    expect(r.unavailable?.reason).toBe('bande-analyse-absente')
    expect(r.bands).toEqual([])
  })
})

/**
 * 160 Hz — CAS HORS GOLDEN `main`, et volontairement : `main` rendait kt = 0 en
 * 98-01 (seuil 15 appliqué à tort) et kt = 5 en 2026. Les deux textes (Note
 * 98-01, annexe IV, Tableau 4 ; MELCCFP 2026, §3.7.4, Tableau 2) placent
 * 160 Hz à 8 dB et plus : les deux cadres doivent conclure à une tonalité.
 * Valeurs attendues établies à la main, pas relevées sur le code :
 *   Δprec = Δsuiv = 58,5 − 50 = 8,5 ≥ 8 ; LAeq_bande = 58,5 − 13,4 = 45,1 ;
 *   Ba − 45,1 = 9,9 ⇒ ni ≥ 15 (2026) ni > 14,5 (98-01) ⇒ non exclue.
 */
describe('160 Hz, Δ = 8,5 dB — tonal dans les DEUX cadres', () => {
  const spectrum = spectre(FREQS_831C, 50, { 160: 58.5 })
  for (const [cadre, fn] of [['2026', analyzeKt], ['98-01', analyzeKt9801]] as const) {
    it(cadre, () => {
      const r = fn(spectrum, 55, FREQS_831C)
      expect(r.unavailable).toBeNull()
      expect(r.kt).toBe(5)
      expect(r.triggeringIndex).toBe(5)
      const b = r.bands[5]
      expect(b.freq).toBe(160)
      expect(b.threshold).toBe(8)
      expect(b.diffPrev).toBe(8.5)
      expect(b.diffNext).toBe(8.5)
      expect(b.excluded).toBe(false)
      expect(b.isTonal).toBe(true)
    })
  }
})

/**
 * Ce que la branche REFUSE, et pourquoi elle existe. Ces refus ne sont pas des
 * effets de bord du correctif : ce sont sa raison d’être.
 */
describe('analyzeKt — refus', () => {
  const F_6HZ = [
    6.3, 8, 10, 12.5, 16, 20, 25, 31.5, 40,
    50, 63, 80, 100, 125, 160, 200, 250, 315, 400,
    500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000,
    5000, 6300, 8000, 10000, 12500, 16000, 20000,
  ]

  it('(g) SPECTRE TROUÉ : bande manquante au milieu → bande-analyse-absente', () => {
    // Des bandes d’analyse plus hautes que la manquante sont présentes : c’est un
    // TROU, pas une plage écourtée. Les Δ se calculent entre bandes ADJACENTES ;
    // analyser malgré le trou les fausserait en silence.
    const freqs = FREQS_831C.filter((f) => f !== 1000)
    const r = analyzeKt(spectre(freqs, 50, { 1250: 70 }), 55, freqs)
    expect(r.unavailable).not.toBeNull()
    expect(r.unavailable?.reason).toBe('bande-analyse-absente')
    expect(r.unavailable?.message).toContain('1000 Hz est absente')
    // Le kt de 0 qui accompagne un refus ne se lit JAMAIS « pas de tonalité ».
    expect(r.kt).toBe(0)
    expect(r.triggeringIndex).toBeNull()
    expect(r.bands).toEqual([])
  })

  it('spectre ne démarrant pas à 50 Hz → bande-analyse-absente', () => {
    const freqs = KT_BAND_FREQS.slice(3) // 100 Hz →, 50/63/80 manquent
    const r = analyzeKt(spectre(freqs, 50, { 1000: 70 }), 55, freqs)
    expect(r.unavailable?.reason).toBe('bande-analyse-absente')
    expect(r.unavailable?.message).toContain('50 Hz est absente')
  })

  it('GAIN — spectre démarrant à 6,3 Hz : main refusait, la branche calcule la BONNE bande', () => {
    // main : REFUS [alignement-non-verifiable] « spectre débute à 6.3 Hz ».
    // C’est le défaut d’origine de la branche : neuf bandes de décalage.
    const r = analyzeKt(F_6HZ.map((f) => (f === 1000 ? 70 : 50)), 55, F_6HZ)
    expect(r.unavailable).toBeNull()
    expect(r.kt).toBe(5)
    expect(r.bands[r.triggeringIndex as number].freq).toBe(1000)
  })
})

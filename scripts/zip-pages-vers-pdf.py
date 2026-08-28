#!/usr/bin/env python3
"""
Assemble une archive « pages JPEG + manifest.json » en un vrai PDF.

Contexte : les trois documents normatifs ont été fournis sous forme d'archives
ZIP (pages rastérisées en JPEG + texte par page + manifest.json) portant à tort
l'extension .pdf. PDF.js ne peut rien en faire — il lui faut un PDF réel,
commençant par %PDF-.

Ce script réencapsule les JPEG SANS RECOMPRESSION : les octets d'origine sont
insérés tels quels comme flux image /DCTDecode. Aucune perte de qualité, aucune
dépendance externe (stdlib seule : zipfile, json, zlib).

Usage :
    python scripts/zip-pages-vers-pdf.py <archive.zip> <sortie.pdf>

Limite assumée : le PDF produit est une suite d'images. Il n'a PAS de couche
texte, donc il n'est ni sélectionnable ni indexable. C'est sans effet sur la
visionneuse intégrée (rendu canvas), et la recherche plein texte dans les
documents embarqués est hors portée de ce chantier.
"""

import json
import sys
import zipfile

# Largeur de page imposée, en points PostScript (8,5 po × 72 = 612 pt).
#
# On NE déduit PAS la taille de page d'une résolution de numérisation supposée :
# le manifest ne la donne pas, et les trois archives n'ont ni la même taille de
# raster ni le même rapport d'aspect (952×1260 pour deux d'entre elles, 896×1372
# pour la troisième). Une valeur de ppp inventée produirait des pages trop
# petites et un zoom 100 % trompeur. On fixe donc la largeur et on déduit la
# hauteur du rapport d'aspect réel de chaque page — le rapport est préservé,
# et le zoom 100 % correspond à une page de largeur Lettre.
LARGEUR_PAGE_PT = 612.0


def objet(num, corps: bytes) -> bytes:
    return b"%d 0 obj\n" % num + corps + b"\nendobj\n"


# Marqueurs SOF (début de trame) hors SOF4/SOF8/SOF12 qui ne sont pas des trames.
SOF = {0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF}

ESPACES = {1: b"/DeviceGray", 3: b"/DeviceRGB", 4: b"/DeviceCMYK"}


def lire_entete_jpeg(data: bytes):
    """Renvoie (largeur, hauteur, nb_composantes) lus dans le JPEG lui-même.

    On ne fait PAS confiance au manifest pour l'espace colorimétrique : déclarer
    /DeviceRGB sur un JPEG en niveaux de gris produit une page illisible. La
    seule source d'autorité est l'en-tête de trame du fichier.
    """
    i = 2
    while i < len(data) - 9:
        if data[i] != 0xFF:
            i += 1
            continue
        marqueur = data[i + 1]
        if marqueur in SOF:
            hauteur = int.from_bytes(data[i + 5 : i + 7], "big")
            largeur = int.from_bytes(data[i + 7 : i + 9], "big")
            composantes = data[i + 9]
            return largeur, hauteur, composantes
        if marqueur in (0xD8, 0x01) or 0xD0 <= marqueur <= 0xD7:
            i += 2
            continue
        longueur = int.from_bytes(data[i + 2 : i + 4], "big")
        if longueur < 2:
            break
        i += 2 + longueur
    raise SystemExit("en-tête JPEG illisible : aucun marqueur SOF trouvé")


def construire_pdf(pages, sortie):
    """pages : liste de (octets_jpeg, largeur_px, hauteur_px, nb_composantes)."""
    # Numérotation : 1 = Catalog, 2 = Pages, puis 3 objets par page.
    n_pages = len(pages)
    ids_pages = [3 + 3 * i for i in range(n_pages)]

    corps = []
    corps.append((1, b"<< /Type /Catalog /Pages 2 0 R >>"))

    kids = b" ".join(b"%d 0 R" % i for i in ids_pages)
    corps.append((2, b"<< /Type /Pages /Kids [%s] /Count %d >>" % (kids, n_pages)))

    for i, (jpeg, largeur, hauteur, composantes) in enumerate(pages):
        id_page = ids_pages[i]
        id_contenu = id_page + 1
        id_image = id_page + 2

        # Largeur fixée, hauteur déduite du rapport d'aspect réel de la page.
        pw = LARGEUR_PAGE_PT
        ph = LARGEUR_PAGE_PT * hauteur / largeur

        corps.append(
            (
                id_page,
                b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %.2f %.2f] "
                b"/Resources << /XObject << /Im0 %d 0 R >> >> /Contents %d 0 R >>"
                % (pw, ph, id_image, id_contenu),
            )
        )

        flux = b"q %.2f 0 0 %.2f 0 0 cm /Im0 Do Q" % (pw, ph)
        corps.append(
            (id_contenu, b"<< /Length %d >>\nstream\n" % len(flux) + flux + b"\nendstream")
        )

        corps.append(
            (
                id_image,
                b"<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                b"/ColorSpace %s /BitsPerComponent 8 /Filter /DCTDecode "
                b"/Length %d >>\nstream\n"
                % (largeur, hauteur, ESPACES[composantes], len(jpeg))
                + jpeg
                + b"\nendstream",
            )
        )

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    decalages = {}
    for num, c in sorted(corps):
        decalages[num] = len(out)
        out += objet(num, c)

    debut_xref = len(out)
    total = max(decalages) + 1
    out += b"xref\n0 %d\n" % total
    out += b"0000000000 65535 f \n"
    for num in range(1, total):
        out += b"%010d 00000 n \n" % decalages[num]
    out += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n" % (total, debut_xref)

    with open(sortie, "wb") as f:
        f.write(out)
    return len(out)


def main():
    if len(sys.argv) != 3:
        print(__doc__)
        return 2
    source, sortie = sys.argv[1], sys.argv[2]

    with zipfile.ZipFile(source) as z:
        manifest = json.loads(z.read("manifest.json"))
        pages = []
        for p in sorted(manifest["pages"], key=lambda x: x["page_number"]):
            img = p["image"]
            if img.get("media_type") != "image/jpeg":
                raise SystemExit(f"page {p['page_number']} : type {img.get('media_type')} non géré")
            octets = z.read(img["path"])
            if octets[:2] != b"\xff\xd8":
                raise SystemExit(f"page {p['page_number']} : {img['path']} n'est pas un JPEG")
            largeur, hauteur, composantes = lire_entete_jpeg(octets)
            if composantes not in ESPACES:
                raise SystemExit(
                    f"page {p['page_number']} : {composantes} composantes, espace non géré"
                )
            pages.append((octets, largeur, hauteur, composantes))

    taille = construire_pdf(pages, sortie)
    print(f"{sortie} — {len(pages)} pages, {taille} octets")
    return 0


if __name__ == "__main__":
    sys.exit(main())

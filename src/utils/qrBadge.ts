/**
 * Helpers pour générer un badge QR + libellé "AcoustiQ" et le dessiner sur
 * un canvas existant. Utilisé par tous les exports PNG.
 */
import QRCode from 'qrcode'

export const ACOUSTIQ_URL = 'https://acoustiq-app.pages.dev'

/**
 * Dessine un petit badge (QR + libellé "AcoustiQ" + URL) en bas à droite
 * d'un canvas existant. Le canvas est modifié en place.
 *
 * @param canvas    Canvas cible (le badge est dessiné par-dessus le contenu)
 * @param opts.scale  Facteur d'échelle du canvas — par défaut 1.
 *                    Passez 2 quand le canvas vient d'html2canvas avec scale: 2.
 */
export async function drawQrBadge(
  canvas: HTMLCanvasElement,
  opts: { scale?: number } = {},
): Promise<void> {
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  const scale = opts.scale ?? 1
  const qrSize = 60 * scale
  const padding = 8 * scale
  const labelH = 14 * scale
  const totalH = qrSize + labelH + padding * 2
  const totalW = qrSize + padding * 2

  // Génère le QR comme data URL noir sur blanc
  const dataUrl = await QRCode.toDataURL(ACOUSTIQ_URL, {
    width: qrSize,
    margin: 0,
    color: { dark: '#000000', light: '#ffffff' },
  })
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('QR image load failed'))
    img.src = dataUrl
  })

  // Position : coin bas-droit, avec une petite marge
  const margin = 8 * scale
  const x0 = canvas.width - totalW - margin
  const y0 = canvas.height - totalH - margin

  // Fond blanc semi-opaque pour la lisibilité
  ctx.save()
  ctx.fillStyle = 'rgba(255,255,255,0.95)'
  ctx.beginPath()
  const r = 4 * scale
  // Rectangle arrondi (compatibilité)
  ctx.moveTo(x0 + r, y0)
  ctx.lineTo(x0 + totalW - r, y0)
  ctx.quadraticCurveTo(x0 + totalW, y0, x0 + totalW, y0 + r)
  ctx.lineTo(x0 + totalW, y0 + totalH - r)
  ctx.quadraticCurveTo(x0 + totalW, y0 + totalH, x0 + totalW - r, y0 + totalH)
  ctx.lineTo(x0 + r, y0 + totalH)
  ctx.quadraticCurveTo(x0, y0 + totalH, x0, y0 + totalH - r)
  ctx.lineTo(x0, y0 + r)
  ctx.quadraticCurveTo(x0, y0, x0 + r, y0)
  ctx.closePath()
  ctx.fill()

  // QR
  ctx.drawImage(img, x0 + padding, y0 + padding, qrSize, qrSize)

  // Libellé
  ctx.fillStyle = '#0f172a'
  ctx.font = `bold ${10 * scale}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('AcoustiQ', x0 + totalW / 2, y0 + padding + qrSize + 2 * scale)
  ctx.restore()
}

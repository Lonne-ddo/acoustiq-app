import { useEffect, useRef } from 'react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { SOURCES, type SourceResult, isError, type SourceOutcome } from '../../utils/meteoSources'
import type { MeteoPoint } from './PointsList'

interface PointResults {
  point: MeteoPoint
  outcomes: SourceOutcome[]
}

interface Props {
  pointResults: PointResults[]
}

const MAP_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://b.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://c.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
        'https://d.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap © CARTO',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
}

export default function MeteoMap({ pointResults }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const layerObjectsRef = useRef<{
    markers: maplibregl.Marker[]
    sourceIds: string[]
    layerIds: string[]
  }>({ markers: [], sourceIds: [], layerIds: [] })

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-71.2, 46.8],
      zoom: 8,
      attributionControl: { compact: true },
    })
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-left')
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 120, unit: 'metric' }), 'bottom-left')
    mapRef.current = map
    return () => {
      mapRef.current = null
      map.remove()
    }
  }, [])

  // Repaint markers / lines when pointResults change.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const apply = () => {
      // Remove previous markers + lines.
      layerObjectsRef.current.markers.forEach((m) => m.remove())
      layerObjectsRef.current.layerIds.forEach((id) => {
        if (map.getLayer(id)) map.removeLayer(id)
      })
      layerObjectsRef.current.sourceIds.forEach((id) => {
        if (map.getSource(id)) map.removeSource(id)
      })
      layerObjectsRef.current = { markers: [], sourceIds: [], layerIds: [] }

      const validPoints = pointResults.filter(
        (pr) => pr.point.lat != null && pr.point.lng != null,
      )
      if (validPoints.length === 0) return

      const bounds = new maplibregl.LngLatBounds()

      validPoints.forEach((pr, pIdx) => {
        const lat = pr.point.lat as number
        const lng = pr.point.lng as number

        // Marker du point cible (numéroté).
        const el = document.createElement('div')
        el.style.cssText = `
          width: 26px; height: 26px; border-radius: 50%;
          background: #1a1a1a; color: #fff; font-weight: 600;
          font-size: 12px; display: flex; align-items: center; justify-content: center;
          border: 2px solid #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
        `
        el.textContent = String(pIdx + 1)
        const marker = new maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .setPopup(
            new maplibregl.Popup({ offset: 14 }).setHTML(
              `<div style="font-size:12px"><b>${escapeHtml(pr.point.label)}</b><br>${
                pr.point.displayName ? escapeHtml(pr.point.displayName) + '<br>' : ''
              }${lat.toFixed(4)}, ${lng.toFixed(4)}</div>`,
            ),
          )
          .addTo(map)
        layerObjectsRef.current.markers.push(marker)
        bounds.extend([lng, lat])

        // Stations / points-grille par source.
        pr.outcomes.forEach((o, sIdx) => {
          if (isError(o)) return
          const r = o as SourceResult
          const meta = SOURCES[r.source]
          const stnEl = document.createElement('div')
          stnEl.style.cssText = `
            width: 14px; height: 14px; border-radius: 50%;
            background: ${meta.color}; border: 2px solid #fff;
            box-shadow: 0 1px 3px rgba(0,0,0,0.3);
          `
          const stnMarker = new maplibregl.Marker({ element: stnEl })
            .setLngLat([r.station.lng, r.station.lat])
            .setPopup(
              new maplibregl.Popup({ offset: 10 }).setHTML(
                `<div style="font-size:12px"><b>${escapeHtml(meta.label)}</b><br>` +
                  `Pour ${escapeHtml(pr.point.label)}<br>` +
                  `${escapeHtml(r.station.name)}<br>` +
                  `${r.station.lat.toFixed(4)}, ${r.station.lng.toFixed(4)}<br>` +
                  `Distance : ${r.station.distanceKm.toFixed(1)} km</div>`,
              ),
            )
            .addTo(map)
          layerObjectsRef.current.markers.push(stnMarker)
          bounds.extend([r.station.lng, r.station.lat])

          // Trait point ↔ station.
          const lineId = `meteo-line-${pIdx}-${sIdx}`
          map.addSource(lineId, {
            type: 'geojson',
            data: {
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: [
                  [lng, lat],
                  [r.station.lng, r.station.lat],
                ],
              },
            },
          })
          map.addLayer({
            id: lineId,
            type: 'line',
            source: lineId,
            paint: {
              'line-color': meta.color,
              'line-width': 1.5,
              'line-opacity': 0.5,
              'line-dasharray': [2, 2],
            },
          })
          layerObjectsRef.current.sourceIds.push(lineId)
          layerObjectsRef.current.layerIds.push(lineId)
        })
      })

      if (!bounds.isEmpty()) {
        map.fitBounds(bounds, { padding: 50, maxZoom: 11, animate: false })
      }
    }

    if (map.isStyleLoaded()) apply()
    else map.once('load', apply)
  }, [pointResults])

  return (
    <div className="space-y-2">
      <div
        ref={containerRef}
        className="w-full h-[320px] rounded border border-gray-800 bg-gray-900"
      />
      <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
        {Object.values(SOURCES).map((s) => (
          <span key={s.id} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 rounded-full"
              style={{ background: s.color }}
            />
            {s.shortLabel}
          </span>
        ))}
      </div>
    </div>
  )
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

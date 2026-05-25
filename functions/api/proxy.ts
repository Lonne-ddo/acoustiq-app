/**
 * CORS proxy pour les outils standalone (veille, météo, etc.)
 *
 * Cloudflare Pages Function — déployée automatiquement avec AcoustiQ.
 *
 * URL en production :
 *   GET https://acoustiq-app.pages.dev/api/proxy?url={URL_encodée}
 *
 * Configuration dans le standalone HTML
 * (champ « URL de proxy CORS personnalisée ») :
 *   https://acoustiq-app.pages.dev/api/proxy?url={URL}
 *
 * Notes :
 *   - Whitelist de domaines pour empêcher l'usage abusif du proxy
 *   - 100 000 requêtes/jour gratuit (tier free Pages Functions)
 *   - Cache-Control 5 min côté client pour limiter les hits redondants
 */

// Domaines autorisés à passer par le proxy.
// Ajouter au besoin (ex. open.canada.ca si on traite CanadaBuys un jour).
const ALLOWED_HOSTS = [
  'news.google.com',
  'www.donneesquebec.ca',
  'donneesquebec.ca',
  'www.bing.com',
];

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
};

export const onRequest: PagesFunction = async (context) => {
  const { request } = context;

  // CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Lire le paramètre cible
  const target = new URL(request.url).searchParams.get('url');
  if (!target) {
    return errorResponse(
      'Paramètre "url" manquant. Usage : /api/proxy?url=<URL_encodée>',
      400
    );
  }

  // Valider l'URL
  let targetUrl: URL;
  try {
    targetUrl = new URL(target);
  } catch {
    return errorResponse('URL cible invalide', 400);
  }

  // Vérifier domaine autorisé (host exact ou sous-domaine)
  const host = targetUrl.hostname;
  const isAllowed = ALLOWED_HOSTS.some(
    (allowed) => host === allowed || host.endsWith('.' + allowed)
  );
  if (!isAllowed) {
    return errorResponse(
      `Domaine non autorisé : ${host}. ` +
        `Ajouter à ALLOWED_HOSTS dans functions/api/proxy.ts si légitime.`,
      403
    );
  }

  // Forward request
  try {
    const upstream = await fetch(target, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (compatible; AcoustiQVeille/1.0; +https://acoustiq-app.pages.dev)',
        'Accept': '*/*',
      },
    });

    const body = await upstream.arrayBuffer();

    return new Response(body, {
      status: upstream.status,
      headers: {
        ...CORS_HEADERS,
        'Content-Type':
          upstream.headers.get('Content-Type') || 'text/plain; charset=utf-8',
        'Cache-Control': 'public, max-age=300',
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'erreur inconnue';
    return errorResponse(`Erreur upstream : ${msg}`, 502);
  }
};

function errorResponse(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  });
}

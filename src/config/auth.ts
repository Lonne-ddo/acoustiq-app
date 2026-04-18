/**
 * Flag d'activation de l'authentification Supabase.
 *
 * - `false` : mode développement — pas de page de login, pas d'appel au
 *   service d'auth, l'app se lance directement sur l'onglet Analyse.
 *   Le menu utilisateur (email + déconnexion) est masqué et un badge
 *   « DEV MODE » s'affiche dans l'en-tête.
 * - `true` : comportement normal avec login/inscription.
 *
 * Mettre à `true` pour réactiver la page de connexion.
 */
export const AUTH_ENABLED = false

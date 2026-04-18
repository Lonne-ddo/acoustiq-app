# Configuration Supabase — étape 1 (auth utilisateurs)

Ce fichier regroupe les actions à effectuer dans le **dashboard Supabase**
(https://supabase.com/dashboard) après le premier déploiement, pour que la
page d'authentification fonctionne correctement.

> Les projets AcoustiQ restent stockés en local pour cette étape.
> La migration cloud (table `projects` + RLS) sera faite dans un commit
> séparé.

## Projet utilisé

| Paramètre | Valeur |
|---|---|
| URL | `https://rppyxqnfuhkguozrudbe.supabase.co` |
| Clé publishable | `sb_publishable_of3CMZSp88oNAW2TnD9Qyw_HpyuPBYs` |

Les deux sont hardcodées dans `src/lib/supabase.ts` — c'est volontaire pour
cette étape. La sécurité vient des Row Level Security policies côté
Supabase (les clés publishable sont conçues pour être exposées côté client).

## Actions manuelles à effectuer

1. Ouvrir le dashboard : https://supabase.com/dashboard/project/rppyxqnfuhkguozrudbe
2. Aller dans **Authentication → Providers**
3. Vérifier que le provider **Email** est activé (toggle **Enable Email provider**).
4. **Désactiver « Confirm email »** pour cette phase de test :
   - Sans ce réglage, chaque inscription déclenche un envoi d'email de confirmation et l'utilisateur ne peut pas se connecter tant qu'il n'a pas cliqué sur le lien.
   - Dashboard : `Authentication → Providers → Email → Confirm email` → **OFF**.
5. Sauvegarder.

## Vérifications côté app

- Inscription via `/` (page AuthPage) → nouvel utilisateur visible dans
  `Authentication → Users` du dashboard Supabase.
- Connexion → bascule automatique sur l'application principale
  (`<App />` dans `src/main.tsx`).
- Refresh navigateur → la session est conservée (stockage localStorage du
  SDK Supabase) et l'utilisateur reste connecté.
- Clic sur « Se déconnecter » dans le menu utilisateur (en haut à droite) →
  retour sur la page AuthPage.

## Plus tard (pré-production)

- **Réactiver « Confirm email »** pour que les nouveaux comptes soient
  validés par un lien envoyé par email.
- Personnaliser le template de l'email de confirmation
  (`Authentication → Email Templates`).
- Définir un domaine SMTP custom si besoin.
- Ajouter des policies RLS sur la future table `projects` (migration cloud).

# Publication Power Apps — authentification `pac`

AcoustiQ est publié comme *code app* Power Apps avec la CLI Power Platform
(`pac`). Sur le poste Englobe, `pac` est installé hors du PATH :

```
%LOCALAPPDATA%\Microsoft\PowerAppsCLI\Microsoft.PowerApps.CLI.2.10.1\tools\pac
```

## L'authentification EXPIRE — la relancer avant toute publication

Le profil `pac` repose sur un jeton Entra ID qui est **révoqué** par un
changement ou une réinitialisation de mot de passe, et expire de toute façon.
Constaté le 2026-09-23 : profil révoqué depuis le 2026-08-31
(`AADSTS50173 … a fresh auth token is needed`) — `pac code list` échouait.

**Avant toute publication** (`pac code push`), vérifier puis, si besoin,
relancer :

```sh
pac auth list        # profil actif (*) et environnement
pac code list        # échoue avec AADSTS… si le jeton est révoqué ou expiré
pac auth create --deviceCode --environment https://org0fdb1b66.crm3.dynamics.com/
```

`--deviceCode` affiche une adresse et un code à saisir dans un navigateur :
utile depuis un terminal non interactif. Sans cette option, `pac auth create`
ouvre une fenêtre de connexion.

Une publication faite avec un jeton expiré échoue : il n'y a pas de risque de
publication partielle silencieuse, mais le chantier « publié » ne l'est pas
tant que `pac code push` n'a pas réussi.

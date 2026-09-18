# Alerte de disponibilité OVH VPS-3

Ce projet Compose est indépendant de RankMe : pas de port publié, pas de réseau
partagé, aucun accès aux conteneurs ou données de l'application. Il interroge
l'API publique OVH toutes les dix minutes et envoie un e-mail uniquement lors du
passage à l'état disponible dans un datacentre français (RBX, GRA ou SBG).

## Secret Gmail

Créez dans Google un mot de passe d'application pour l'adresse Gmail expéditrice, puis
créez le fichier local suivant, sans le commiter :

```sh
mkdir -p secrets
umask 077
read -rsp 'Mot de passe d’application Gmail : ' secret; printf '%s' "$secret" > secrets/gmail_app_password.txt; unset secret; echo
```

## Démarrage

```sh
docker compose up -d --build
docker compose logs -f
```

Le secret est monté seulement dans le conteneur sous `/run/secrets/`, tandis que
l'état est conservé dans le volume Docker `ovh_stock_alert_state` afin qu'un
redémarrage ne génère pas de doublon.

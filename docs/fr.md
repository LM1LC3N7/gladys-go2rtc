# go2rtc

**Intégration non officielle, sans lien avec le projet go2rtc.** Elle
transforme les flux d'un serveur [go2rtc](https://github.com/AlexxIT/go2rtc)
en caméras Gladys. go2rtc (libre, par AlexxIT) parle presque toutes les
langues des caméras : caméras RTSP et ONVIF, caméras HomeKit (Aqara G100…),
TP-Link Tapo et Kasa, Xiaomi, enregistreurs DVR-IP, Ring, Tuya, webcams USB,
adresses d'images HTTP… Un flux go2rtc = une caméra dans Gladys, quelle que
soit la marque.

Deux façons de l'utiliser :

- **le go2rtc lancé par Gladys** : rien à installer, Gladys démarre l'image
  officielle de go2rtc à côté de l'intégration ; vous saisissez vos flux dans
  la configuration, ou les ajoutez dans la page web de go2rtc ;
- **votre propre go2rtc** : un go2rtc que vous faites déjà tourner (Docker,
  module complémentaire Home Assistant…), ou celui de **Frigate**.

**Version de développement (0.1)** : testée avec un vrai go2rtc 1.9.14
alimenté par des mires vidéo (H.264, MJPEG, une caméra réseau coupée puis
réparée), pas encore avec de vraies caméras. Dites-nous sur le forum ce qui
marche avec les vôtres.

## Ce que vous obtenez

| Élément                     | Contenu                                                                                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Une caméra par **flux**     | Son image sur le tableau de bord, rafraîchie au rythme choisi ; une image fraîche quand vous ouvrez la vue en direct ou qu'une scène envoie l'image         |
| Un badge par caméra         | **local** tant que la caméra envoie des images à go2rtc, **injoignable** après deux lectures ratées de suite                                                |
| Déclencheurs de scène       | **Caméra hors ligne** (la caméra ne répond pas, son flux a quitté go2rtc, ou go2rtc ne répond pas) et **Caméra de nouveau en ligne**                        |
| Boutons de la configuration | **Tester la connexion à go2rtc**, **Vérifier chaque flux** (go2rtc se connecte à chacun : en ligne avec son codec vidéo, ou pourquoi pas)                   |
| go2rtc lancé par Gladys     | Sa page web (vidéo en direct en WebRTC ou MSE, ajout de flux, appairage HomeKit) et une rediffusion RTSP de chaque flux pour d'autres logiciels (VLC, NVR…) |

## Le go2rtc lancé par Gladys

1. Installez l'intégration. Dans **Configuration**, gardez **Le go2rtc lancé
   par Gladys**.
2. Choisissez un **Mot de passe web** : il protège la page web de go2rtc et
   la rediffusion RTSP (utilisateur `admin`). Sans lui, Gladys choisit un mot
   de passe au hasard et la page web reste fermée.
3. Remplissez un **Flux : nom** et un **Flux : source** par caméra
   (6 emplacements ; au-delà, ajoutez-les dans la page web de go2rtc). Le nom
   devient le nom de la caméra dans Gladys ; le changer plus tard crée une
   nouvelle caméra.
4. Enregistrez. Le premier démarrage télécharge l'image go2rtc (environ
   95 Mo) : l'état peut indiquer « ne répond pas encore » pendant une minute.
5. Ouvrez **Découverte** et ajoutez vos caméras.

Exemples de sources (voir la
[documentation de go2rtc](https://github.com/AlexxIT/go2rtc#module-streams)) :

| Caméra                           | Source                                                                                   |
| -------------------------------- | ---------------------------------------------------------------------------------------- |
| RTSP (la plupart des caméras IP) | `rtsp://utilisateur:motdepasse@192.168.1.20:554/stream1`                                 |
| ONVIF                            | `onvif://utilisateur:motdepasse@192.168.1.20`                                            |
| TP-Link Tapo (sans RTSP)         | `tapo://motdepasse-cloud@192.168.1.21`                                                   |
| Enregistreur DVR-IP (XMeye)      | `dvrip://utilisateur:motdepasse@192.168.1.22:34567?channel=0&subtype=0`                  |
| Image HTTP ou MJPEG              | `http://192.168.1.23/snapshot.jpg` ou `ffmpeg:http://192.168.1.23/video.mjpg#video=h264` |
| Webcam USB sur ce serveur        | `ffmpeg:device?video=0&video_size=1280x720#video=h264` (voir plus bas)                   |

**Webcam USB** : le conteneur go2rtc ne voit que les périphériques vidéo que
vous autorisez. Accordez le matériel **video** au conteneur go2rtc dans
Gladys (écran d'installation, ou les accès matériels de l'intégration), puis
utilisez la source ci-dessus (`video=0` est `/dev/video0`). `#video=h264`
fait encoder du H.264 à go2rtc pour les navigateurs ; cela coûte du
processeur (le conteneur peut utiliser un cœur).

**La page web** : son adresse est dans l'écran de configuration
(`http://<votre Gladys>:<port>/`), et la supervision de l'intégration
affiche un lien « Ouvrir ». Connectez-vous avec `admin` et votre mot de passe
web. La vidéo est lue en WebRTC ou en MSE. Pour le WebRTC, saisissez
l'adresse IP de la machine Gladys dans **Adresse de cette machine Gladys
(WebRTC)** ; sans elle, la page utilise le MSE, qui fonctionne dans les
navigateurs récents (Chrome, Firefox, Edge, Safari 17+).

**Rediffusion RTSP** : `rtsp://admin:<mot de passe web>@<votre Gladys>:<port>/<nom du flux>`
(le port est dans l'écran de configuration). Pratique pour donner à un autre
logiciel les caméras que go2rtc sait déjà joindre (Tapo, HomeKit…).

**Vos propres réglages** : Gladys écrit les flux du formulaire dans
`gladys.yaml` et ne touche jamais au `go2rtc.yaml` voisin, que la page web
de go2rtc modifie (Config) : un flux ajouté là, un appairage HomeKit, vos
préréglages `ffmpeg` survivent aux redémarrages et aux mises à jour. Les
réglages dont Gladys a besoin (mot de passe de l'API et du RTSP, ports,
journaux) et les flux du formulaire l'emportent sur les mêmes clés de
`go2rtc.yaml`.

**Caméras HomeKit** (Aqara G100…) : go2rtc a besoin du mDNS avec elles, pour
les appairer et pour les retrouver, et le mDNS ne traverse pas le réseau
isolé des conteneurs de Gladys. Faites tourner go2rtc sur le réseau de
l'hôte (Docker `network_mode: host`), appairez la caméra dans sa page web,
puis choisissez **votre propre go2rtc** ci-dessous.

## Votre propre go2rtc (ou celui de Frigate)

1. Dans **Configuration**, choisissez **Mon propre serveur go2rtc (ou celui
   de Frigate)**.
2. **Adresse de go2rtc** : l'adresse de son API, port 1984 par défaut :
   `http://192.168.1.10:1984`. Utilisez l'adresse réseau de la machine :
   `localhost` désignerait l'intérieur des conteneurs de Gladys.
3. Si go2rtc demande un mot de passe (`api: username / password` dans sa
   configuration), remplissez **Identifiant go2rtc** et **Mot de passe
   go2rtc**.
4. Enregistrez, puis ouvrez **Découverte** : tous les flux de votre go2rtc
   sont listés.

**Frigate** : Frigate fait tourner go2rtc dans son conteneur, sur le
port 1984. Publiez-le dans votre `docker-compose.yml` (`- "1984:1984"` sous
`ports:`), puis utilisez `http://<hôte de Frigate>:1984`. Ce port n'a pas de
mot de passe sauf si vous en mettez un dans la section `go2rtc:` de la
configuration de Frigate (`api: username / password`) : gardez-le sur votre
réseau local. Les caméras du go2rtc de Frigate sont celles de sa section
`go2rtc: streams:`.

Gladys lit seulement votre go2rtc (la liste des flux et les images) : il ne
modifie jamais sa configuration. Quand vous choisissez ce mode, le go2rtc
lancé par Gladys est arrêté.

## Images

- Le tableau de bord affiche la dernière image reçue par Gladys ;
  **Rafraîchissement de l'image** règle la fréquence d'envoi d'une nouvelle
  image (toutes les 5 secondes à toutes les 10 minutes, ou aucun). Chaque
  image est un instantané : go2rtc se connecte à la caméra si personne ne la
  regarde, attend une image clé et la convertit en JPEG. Un rythme rapide
  charge davantage vos caméras et la machine Gladys ; une image par minute
  est un bon début.
- La vue en direct (et l'action de scène « envoyer l'image de la caméra »)
  demande une image fraîche, jusqu'à 1280 pixels de large.
- Gladys accepte des images jusqu'à 150 Ko (60 Ko pour l'image gardée sur la
  caméra) : go2rtc redimensionne lui-même les flux H.264 et H.265 ; un flux
  MJPEG (webcam USB, caméra HTTP) est redimensionné par l'intégration.
- Avec **Aucun**, aucune image n'est envoyée et l'état de chaque caméra est
  vérifié toutes les 5 minutes.

## Scènes

- **Caméra hors ligne** : une caméra (ou aucune pour toutes) et, en option,
  une raison : `source` (la caméra ne répond pas à go2rtc), `server` (go2rtc
  ne répond pas), `removed` (le flux n'est plus dans go2rtc). Variables : le
  nom du flux et la raison. Une caméra est hors ligne après deux lectures
  ratées de suite : un simple raté n'envoie rien.
- **Caméra de nouveau en ligne** : une caméra qui était hors ligne envoie de
  nouveau des images.

Une caméra déjà hors ligne au démarrage de l'intégration n'envoie aucun
événement : seuls les changements en envoient.

## Dépannage

- **« go2rtc ne répond pas »** : vérifiez l'adresse et le port, et que la
  machine de go2rtc accepte les connexions de la machine Gladys.
- **« a refusé l'identifiant ou le mot de passe »** : l'utilisateur et le mot
  de passe `api:` de votre go2rtc.
- **« ne répond pas comme go2rtc »** : l'adresse désigne un autre service (le
  port RTSP 8554, le port web de Frigate…) : utilisez le port de l'API, 1984.
- **« Le conteneur go2rtc n'a pas pu démarrer »** : consultez les logs de
  l'intégration (Configuration → supervision) ; l'image go2rtc n'est
  peut-être pas encore téléchargée.
- **Une caméra reste injoignable** : appuyez sur **Vérifier chaque flux** :
  go2rtc dit pourquoi (délai dépassé, mot de passe refusé, codec inconnu).
  Essayez la même source dans la page web de go2rtc.
- L'intégration n'écrit jamais l'adresse ni le mot de passe d'une caméra
  dans ses logs.

## Vie privée

Tout reste sur votre réseau : l'intégration ne parle qu'à go2rtc, et go2rtc
à vos caméras. Les adresses de caméras saisies dans la configuration sont
stockées par Gladys comme toute valeur de configuration (visibles des
administrateurs de Gladys). Le go2rtc lancé par Gladys demande toujours un
mot de passe sur sa page web et sa rediffusion RTSP, car Gladys publie ces
ports sur votre réseau local.

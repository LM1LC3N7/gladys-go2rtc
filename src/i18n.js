// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys (connection status, buttons, errors).
// Errors thrown to Gladys are English (one language per message, like the
// core's); the statuses and button answers are { en, fr }.
// -----------------------------------------------------------------------------

import { CODES } from './go2rtc/errors.js';

const plural = (n, one, many) => (n === 1 ? one : many);
const go2rtc = (version) => (version ? `go2rtc ${version}` : 'go2rtc');
const join = (...parts) => ({
  en: parts.map((p) => p.en).join(' '),
  fr: parts.map((p) => p.fr).join(' '),
});

/** Why go2rtc or a stream failed, in a few words. */
export function reasonOf(err) {
  switch (err?.code) {
    case CODES.UNREACHABLE:
      return { en: 'no connection', fr: 'pas de connexion' };
    case CODES.TIMEOUT:
      return { en: 'no answer in time', fr: 'pas de réponse à temps' };
    case CODES.AUTH:
      return { en: 'user name or password refused', fr: 'identifiant ou mot de passe refusé' };
    case CODES.NOT_FOUND:
      return { en: 'no such stream in go2rtc', fr: 'flux absent de go2rtc' };
    case CODES.NO_FRAME:
      return { en: 'the camera sent no image', fr: "la caméra n'a envoyé aucune image" };
    case CODES.SOURCE:
      return {
        en: `the camera failed (${err.message})`,
        fr: `la caméra a échoué (${err.message})`,
      };
    case CODES.IMAGE_TOO_LARGE:
      return { en: 'image too large for Gladys', fr: 'image trop lourde pour Gladys' };
    case CODES.BAD_ANSWER:
      return { en: 'unexpected answer', fr: 'réponse inattendue' };
    default:
      return { en: err?.message ?? 'error', fr: err?.message ?? 'erreur' };
  }
}

export const T = {
  status: {
    ok: ({ version, count }) => ({
      en: `${go2rtc(version)} answers: ${count} ${plural(count, 'stream', 'streams')}.`,
      fr: `${go2rtc(version)} répond : ${count} flux.`,
    }),
    noStream: {
      en: 'Add streams in the configuration below (or in the go2rtc web page), then open Discovery.',
      fr: 'Ajoutez des flux dans la configuration ci-dessous (ou dans la page web de go2rtc), puis ouvrez Découverte.',
    },
    webPage: (port) => ({
      en: `go2rtc web page: port ${port} of this Gladys machine, user admin.`,
      fr: `Page web de go2rtc : port ${port} de cette machine Gladys, utilisateur admin.`,
    }),
    setWebPassword: {
      en: 'Set a web password to open it.',
      fr: 'Choisissez un mot de passe web pour l’ouvrir.',
    },
    invalidSlots: (slots) => ({
      en: `Ignored stream slot(s) ${slots.join(', ')}: name used twice, too long or with a line break.`,
      fr: `Emplacement(s) de flux ignoré(s) ${slots.join(', ')} : nom en double, trop long ou avec un retour à la ligne.`,
    }),
    invalidWebrtc: {
      en: 'The WebRTC address is not a host name or an IPv4 address: ignored.',
      fr: "L'adresse WebRTC n'est ni un nom d'hôte ni une adresse IPv4 : ignorée.",
    },
    urlEmpty: {
      en: 'Type the address of your go2rtc server (e.g. http://192.168.1.10:1984), or choose the go2rtc run by Gladys.',
      fr: 'Saisissez l’adresse de votre serveur go2rtc (ex. http://192.168.1.10:1984), ou choisissez le go2rtc lancé par Gladys.',
    },
    urlInvalid: {
      en: 'The go2rtc address is not valid: type http://host:port (e.g. http://192.168.1.10:1984).',
      fr: "L'adresse de go2rtc n'est pas valide : saisissez http://hôte:port (ex. http://192.168.1.10:1984).",
    },
    urlCredentials: {
      en: 'Remove the user name and password from the go2rtc address: they have their own fields.',
      fr: "Retirez l'identifiant et le mot de passe de l'adresse de go2rtc : ils ont leurs propres champs.",
    },
    unreachable: (err) =>
      join({ en: 'go2rtc does not answer:', fr: 'go2rtc ne répond pas :' }, reasonOf(err), {
        en: '— check the address, and that the port is open to Gladys.',
        fr: '— vérifiez l’adresse, et que le port est ouvert à Gladys.',
      }),
    auth: {
      en: 'go2rtc refused the user name or password (its api: username / password).',
      fr: "go2rtc a refusé l'identifiant ou le mot de passe (son api: username / password).",
    },
    notGo2rtc: {
      en: 'This address does not answer like go2rtc: point it to the go2rtc API port (1984 by default).',
      fr: "Cette adresse ne répond pas comme go2rtc : indiquez le port de l'API go2rtc (1984 par défaut).",
    },
    bundledFailed: (message) => ({
      en: `The go2rtc container could not start (${message}): see the integration logs.`,
      fr: `Le conteneur go2rtc n'a pas pu démarrer (${message}) : consultez les logs de l'intégration.`,
    }),
    starting: {
      en: 'The go2rtc container does not answer yet: it may still be downloading or starting.',
      fr: 'Le conteneur go2rtc ne répond pas encore : il est peut-être encore en téléchargement ou en démarrage.',
    },
  },
  test: {
    ok: ({ version, count, names }) => ({
      en: `${go2rtc(version)} answers, ${count} ${plural(count, 'stream', 'streams')}${count ? `: ${names}` : ''}.`,
      fr: `${go2rtc(version)} répond, ${count} flux${count ? ` : ${names}` : ''}.`,
    }),
  },
  check: {
    none: {
      en: 'go2rtc has no stream yet.',
      fr: "go2rtc n'a encore aucun flux.",
    },
    online: (codecs) => ({
      en: `online${codecs.length ? ` (${codecs.join(', ')})` : ''}`,
      fr: `en ligne${codecs.length ? ` (${codecs.join(', ')})` : ''}`,
    }),
    offline: (err) => {
      const reason = reasonOf(err);
      return { en: `offline, ${reason.en}`, fr: `hors ligne, ${reason.fr}` };
    },
    skipped: { en: 'not checked (time is up)', fr: 'non vérifié (temps écoulé)' },
  },
  errors: {
    unknownCamera: 'Unknown camera: pick a camera of this integration',
    notConnected: 'go2rtc is not connected: see the configuration of the integration',
    image: (name, err) => `No image of "${name}": ${reasonOf(err).en}`,
  },
};

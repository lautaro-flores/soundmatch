import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';
const MUSICBRAINZ_USER_AGENT = process.env.MUSICBRAINZ_USER_AGENT || 'SoundMatchLLMAgent/2.0 (local-dev@example.com)';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const CONTINENTS = new Set(['latam', 'europe', 'northamerica', 'africa', 'asia', 'oceania', 'middleeast', 'all']);
const PRECISIONS = new Set(['strict', 'balanced', 'exploratory']);
const MODES = new Set(['similar', 'scene']);

const COUNTRY_NAME_TO_CONTINENT = {
  argentina: 'latam', uruguay: 'latam', chile: 'latam', brazil: 'latam', brasil: 'latam', colombia: 'latam', mexico: 'latam', mejico: 'latam', peru: 'latam', bolivia: 'latam', paraguay: 'latam', venezuela: 'latam', ecuador: 'latam', cuba: 'latam', 'dominican republic': 'latam', 'puerto rico': 'latam', costa: 'latam', 'costa rica': 'latam', guatemala: 'latam', panama: 'latam', 'el salvador': 'latam', honduras: 'latam', nicaragua: 'latam',
  italy: 'europe', italia: 'europe', venice: 'europe', venezia: 'europe', france: 'europe', germany: 'europe', spain: 'europe', portugal: 'europe', netherlands: 'europe', 'the netherlands': 'europe', holland: 'europe', belgium: 'europe', sweden: 'europe', norway: 'europe', denmark: 'europe', finland: 'europe', iceland: 'europe', ireland: 'europe', 'united kingdom': 'europe', uk: 'europe', england: 'europe', scotland: 'europe', wales: 'europe', poland: 'europe', austria: 'europe', switzerland: 'europe', greece: 'europe', russia: 'europe', czechia: 'europe', 'czech republic': 'europe', hungary: 'europe', romania: 'europe', serbia: 'europe', croatia: 'europe', slovenia: 'europe', slovakia: 'europe', ukraine: 'europe', estonia: 'europe', latvia: 'europe', lithuania: 'europe', luxembourg: 'europe',
  'united states': 'northamerica', usa: 'northamerica', us: 'northamerica', 'united states of america': 'northamerica', america: 'northamerica', canada: 'northamerica',
  japan: 'asia', 'south korea': 'asia', korea: 'asia', china: 'asia', india: 'asia', thailand: 'asia', indonesia: 'asia', philippines: 'asia', vietnam: 'asia', malaysia: 'asia', singapore: 'asia', taiwan: 'asia', hong: 'asia', 'hong kong': 'asia', pakistan: 'asia', nepal: 'asia',
  australia: 'oceania', 'new zealand': 'oceania', fiji: 'oceania',
  nigeria: 'africa', ghana: 'africa', senegal: 'africa', mali: 'africa', morocco: 'africa', egypt: 'africa', 'south africa': 'africa', kenya: 'africa', ethiopia: 'africa', algeria: 'africa', tunisia: 'africa', angola: 'africa', cameroon: 'africa', congo: 'africa',
  turkey: 'middleeast', turkiye: 'middleeast', israel: 'middleeast', iran: 'middleeast', iraq: 'middleeast', lebanon: 'middleeast', jordan: 'middleeast', syria: 'middleeast', 'saudi arabia': 'middleeast', uae: 'middleeast', 'united arab emirates': 'middleeast', qatar: 'middleeast', kuwait: 'middleeast', oman: 'middleeast', yemen: 'middleeast'
};

const ISO_TO_CONTINENT = {
  AR:'latam', UY:'latam', CL:'latam', BR:'latam', CO:'latam', MX:'latam', PE:'latam', BO:'latam', PY:'latam', VE:'latam', EC:'latam', CU:'latam', DO:'latam', PR:'latam', CR:'latam', GT:'latam', PA:'latam', SV:'latam', HN:'latam', NI:'latam',
  IT:'europe', FR:'europe', DE:'europe', ES:'europe', PT:'europe', NL:'europe', BE:'europe', SE:'europe', NO:'europe', DK:'europe', FI:'europe', IS:'europe', IE:'europe', GB:'europe', PL:'europe', AT:'europe', CH:'europe', GR:'europe', CZ:'europe', HU:'europe', RO:'europe', RS:'europe', HR:'europe', SI:'europe', SK:'europe', UA:'europe', RU:'europe', EE:'europe', LV:'europe', LT:'europe', LU:'europe',
  US:'northamerica', CA:'northamerica',
  JP:'asia', KR:'asia', CN:'asia', IN:'asia', TH:'asia', ID:'asia', PH:'asia', VN:'asia', MY:'asia', SG:'asia', TW:'asia', HK:'asia', PK:'asia', NP:'asia',
  AU:'oceania', NZ:'oceania', FJ:'oceania',
  NG:'africa', GH:'africa', SN:'africa', ML:'africa', MA:'africa', EG:'africa', ZA:'africa', KE:'africa', ET:'africa', DZ:'africa', TN:'africa', AO:'africa', CM:'africa', CD:'africa', CG:'africa',
  TR:'middleeast', IL:'middleeast', IR:'middleeast', IQ:'middleeast', LB:'middleeast', JO:'middleeast', SY:'middleeast', SA:'middleeast', AE:'middleeast', QA:'middleeast', KW:'middleeast', OM:'middleeast', YE:'middleeast'
};

function normalizeText(value = '') {
  return String(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function clampScore(value, fallback = 0) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(100, Math.round(num)));
}

function uniq(values = []) {
  return [...new Set(values.filter(Boolean).map(v => String(v).trim()).filter(Boolean))];
}

function continentFromCountryName(country = '') {
  const key = normalizeText(country);
  if (!key) return '';
  if (COUNTRY_NAME_TO_CONTINENT[key]) return COUNTRY_NAME_TO_CONTINENT[key];

  for (const [countryKey, continent] of Object.entries(COUNTRY_NAME_TO_CONTINENT)) {
    if (key.includes(countryKey) || countryKey.includes(key)) return continent;
  }
  return '';
}

function toDisplayContinent(id) {
  const names = {
    latam: 'Latinoamérica', europe: 'Europa', northamerica: 'Norteamérica', africa: 'África', asia: 'Asia', oceania: 'Oceanía', middleeast: 'Medio Oriente', all: 'Todo el mundo'
  };
  return names[id] || id;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function getLastFmSimilar(seed) {
  if (!LASTFM_API_KEY) return [];
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(seed)}&api_key=${LASTFM_API_KEY}&limit=70&format=json`;
    const data = await fetchJson(url);
    const list = data?.similarartists?.artist || [];
    return list.map(a => ({
      name: a.name,
      lastfm_match: Number(a.match || 0),
      url: a.url || ''
    }));
  } catch (error) {
    console.warn('No se pudo consultar Last.fm similar:', error.message);
    return [];
  }
}

async function getLastFmInfo(artist) {
  if (!LASTFM_API_KEY) return null;
  try {
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getinfo&artist=${encodeURIComponent(artist)}&api_key=${LASTFM_API_KEY}&format=json`;
    const data = await fetchJson(url);
    const info = data?.artist;
    if (!info) return null;
    return {
      name: info.name,
      listeners: Number(info?.stats?.listeners || 0),
      tags: (info?.tags?.tag || []).map(t => t.name).slice(0, 15),
      bio: info?.bio?.summary?.replace(/<[^>]+>/g, '').slice(0, 900) || '',
      url: info.url || ''
    };
  } catch (error) {
    console.warn(`No se pudo consultar Last.fm info para ${artist}:`, error.message);
    return null;
  }
}

async function validateWithMusicBrainz(artistName) {
  try {
    const query = encodeURIComponent(`artist:"${artistName}"`);
    const url = `https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=8`;
    const data = await fetchJson(url, {
      headers: { 'User-Agent': MUSICBRAINZ_USER_AGENT }
    });

    const normalized = normalizeText(artistName);
    const artists = data?.artists || [];
    const exact = artists.find(a => normalizeText(a.name) === normalized) || artists.find(a => normalizeText(a.name).includes(normalized)) || artists[0];
    if (!exact) return null;

    const areaCode = exact?.country || exact?.area?.['iso-3166-1-codes']?.[0] || exact?.['begin-area']?.['iso-3166-1-codes']?.[0] || '';
    const country = exact?.area?.name || exact?.['begin-area']?.name || exact?.country || '';
    const continent = ISO_TO_CONTINENT[areaCode] || continentFromCountryName(country);

    return {
      source: 'MusicBrainz',
      mbid: exact.id,
      country,
      areaCode,
      continent,
      matchedName: exact.name,
      score: exact.score || null
    };
  } catch (error) {
    console.warn(`MusicBrainz falló para ${artistName}:`, error.message);
    return null;
  }
}

function extractJson(text = '') {
  const cleaned = String(text).replace(/```json/gi, '```').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('El LLM no devolvió JSON válido. Probá nuevamente.');
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

function getGeminiSources(response) {
  const grounding = response?.candidates?.[0]?.groundingMetadata || {};
  return (grounding.groundingChunks || [])
    .map((chunk, index) => ({ index: index + 1, title: chunk?.web?.title || '', url: chunk?.web?.uri || '' }))
    .filter(s => s.url);
}

async function callGeminiJson(prompt, temperature = 0.15) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY en el archivo .env o en las variables de entorno del hosting.');
  }
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature
    }
  });
  return { parsed: extractJson(response.text || ''), sources: getGeminiSources(response), rawText: response.text || '' };
}

function formatFeedbackContext(feedback = []) {
  if (!Array.isArray(feedback) || !feedback.length) return 'Sin feedback previo del usuario.';
  const accepted = feedback.filter(x => x?.value === 'up').slice(0, 8).map(x => x.artist).join(', ') || 'ninguno';
  const rejected = feedback.filter(x => x?.value === 'down').slice(0, 8).map(x => `${x.artist}${x.reason ? ` (${x.reason})` : ''}`).join(', ') || 'ninguno';
  return `Feedback local del usuario para ajustar esta sesión. Aceptados: ${accepted}. Rechazados/no se parecen: ${rejected}. Evitá repetir rechazados y acercate al perfil sonoro de aceptados.`;
}

async function callLlmRecommend({ seed, continent, precision, mode, lastfmCandidates, seedInfo, feedbackContext }) {
  const continentLabel = toDisplayContinent(continent);
  const candidatesText = lastfmCandidates.length
    ? lastfmCandidates.slice(0, 70).map((c, i) => `${i + 1}. ${c.name} | Last.fm match: ${c.lastfm_match}`).join('\n')
    : 'No hay candidatos de Last.fm disponibles. Usá búsqueda web para ampliar candidatos.';

  const seedInfoText = seedInfo
    ? JSON.stringify(seedInfo, null, 2)
    : 'Sin metadata de Last.fm para el artista base.';

  const modeText = mode === 'scene'
    ? 'Modo EXPLORAR ESCENA: no te limites a similares directos. Identificá la escena/subgéneros del artista base y buscá artistas del continente elegido que compartan estética, sellos, prensa, escena o sonido.'
    : 'Modo SIMILAR DIRECTO: priorizá artistas que aparezcan como similares, relacionados o escuchados por los mismos fans. Podés ampliar por escena si Last.fm no alcanza.';

  const prompt = `
Sos un agente experto en descubrimiento musical. Necesito recomendaciones precisas, no una lista genérica.

Banda/artista base: "${seed}"
Continente elegido: ${continentLabel} (${continent})
Precisión: ${precision}
${modeText}

Objetivo: detectar artistas/bandas que suenen realmente parecidos a "${seed}" y pertenezcan al continente elegido.

Reglas obligatorias:
1. NO uses una base propia inventada. Usá evidencia pública y razonamiento musical.
2. Priorizá: "fans also listen", "similar artists", reseñas que comparen artistas, escenas compartidas, sellos, giras, tags sonoros, subgéneros, playlists y comunidades.
3. El continente es filtro duro salvo si continent = all. Si el usuario elige Europa, artistas de Estados Unidos como The Velvet Underground deben quedar afuera, aunque sirvan como referencia sonora.
4. No dependas solo de la lista inicial de Last.fm. Si un artista muy relevante no aparece ahí, buscalo igual por escena y similitud web.
5. Para casos tipo "Winona Riders + Europa", artistas como New Candys deben ser considerados si la evidencia pública sostiene que son europeos y sonoramente compatibles.
6. Separá claramente tres cosas: parecido sonoro, escucha cruzada/fans, y validación de origen.
7. No priorices popularidad. Priorizá parecido musical y origen correcto.
8. Si el origen no es confiable, bajá origin_confidence o no lo recomiendes según precisión.
9. Devolvé SOLO JSON válido. Sin markdown, sin texto antes ni después.

Interpretación de precisión:
- strict: país/continente confirmado por evidencia fuerte. No muestres dudosos.
- balanced: país confirmado o evidencia pública consistente. Recomendado para descubrimiento musical.
- exploratory: más variedad, pero marcá menor confianza si el origen o afinidad es menos fuerte.

Búsquedas sugeridas que tenés que cubrir conceptualmente:
- "${seed} similar artists"
- "${seed} fans also listen"
- "bands like ${seed} ${continentLabel}"
- "${seed} genre scene"
- artistas del continente elegido que compartan escena/subgéneros con ${seed}

Metadata del artista base según Last.fm:
${seedInfoText}

Candidatos iniciales de Last.fm:
${candidatesText}

${formatFeedbackContext(feedbackContext)}

Devolvé este JSON exacto:
{
  "seed": "${seed}",
  "selected_continent": "${continent}",
  "detected_scene": ["subgénero/escena 1", "subgénero/escena 2"],
  "recommendations": [
    {
      "name": "Nombre del artista",
      "country": "País de origen",
      "continent": "${continent}",
      "similarity_score": 0,
      "sound_confidence": 0,
      "origin_confidence": 0,
      "fan_overlap_confidence": 0,
      "fan_signal": "evidencia breve de escucha cruzada / similar artists / fans also listen",
      "sound_signal": ["rasgo sonoro 1", "rasgo sonoro 2", "rasgo sonoro 3"],
      "origin_signal": "evidencia breve del país/origen",
      "why": "explicación concreta de por qué encaja con ${seed}",
      "evidence": ["evidencia breve 1", "evidencia breve 2"],
      "source_queries": ["query o fuente 1", "query o fuente 2"],
      "warning": "vacío si no hay advertencias"
    }
  ],
  "debug_notes": ["nota breve sobre cómo se armó la búsqueda"]
}

Devolvé entre 8 y 14 recomendaciones si hay evidencia suficiente.
Puntajes: todos de 0 a 100.
`;

  return callGeminiJson(prompt, 0.12);
}

function postFilterRecommendation(rec, selectedContinent, precision, mbValidation) {
  if (selectedContinent === 'all') return { keep: true, reason: 'Sin filtro de continente.' };

  const countryContinent = continentFromCountryName(rec.country || '');
  const recContinent = rec.continent || countryContinent;
  const mbContinent = mbValidation?.continent || '';
  const llmMatches = recContinent === selectedContinent || countryContinent === selectedContinent;
  const mbMatches = mbContinent === selectedContinent;
  const origin = clampScore(rec.origin_confidence);

  if (precision === 'strict') {
    if (mbMatches) return { keep: true, reason: 'Continente validado con MusicBrainz.' };
    if (llmMatches && countryContinent === selectedContinent && origin >= 82) return { keep: true, reason: 'Continente validado por país + evidencia del LLM.' };
    return { keep: false, reason: 'Descartado: no se pudo validar el continente en modo Alta.' };
  }

  if (precision === 'balanced') {
    if (mbMatches) return { keep: true, reason: 'Continente validado con MusicBrainz.' };
    if (llmMatches && origin >= 62) return { keep: true, reason: 'Continente sostenido por evidencia pública.' };
    return { keep: false, reason: 'Descartado: evidencia de continente insuficiente.' };
  }

  if (mbMatches) return { keep: true, reason: 'Continente validado con MusicBrainz.' };
  if (llmMatches && origin >= 45) return { keep: true, reason: 'Continente probable según evidencia pública.' };
  return { keep: false, reason: 'Descartado: continente demasiado incierto.' };
}

function computeFinalScore(rec) {
  const sim = clampScore(rec.similarity_score);
  const sound = clampScore(rec.sound_confidence);
  const origin = clampScore(rec.origin_confidence);
  const fan = clampScore(rec.fan_overlap_confidence);
  return Math.round((sim * 0.40) + (sound * 0.25) + (origin * 0.22) + (fan * 0.13));
}

function scoreTier(finalScore, rec) {
  const origin = clampScore(rec.origin_confidence);
  const sound = clampScore(rec.sound_confidence);
  if (finalScore >= 85 && origin >= 75 && sound >= 75) return 'Muy recomendado';
  if (finalScore >= 70 && origin >= 60 && sound >= 65) return 'Buena coincidencia';
  return 'Experimental';
}

function normalizeRecommendation(rec, seed, continent, precision, mb, filter) {
  const soundSignal = uniq(Array.isArray(rec.sound_signal) ? rec.sound_signal : []);
  const evidence = uniq(Array.isArray(rec.evidence) ? rec.evidence : []);
  const queries = uniq(Array.isArray(rec.source_queries) ? rec.source_queries : []);
  const originCountry = rec.country || mb?.country || '';
  const mappedContinent = rec.continent || continentFromCountryName(originCountry) || mb?.continent || '';

  const normalized = {
    ...rec,
    name: String(rec.name || '').trim(),
    country: originCountry,
    continent: mappedContinent || continent,
    similarity_score: clampScore(rec.similarity_score),
    sound_confidence: clampScore(rec.sound_confidence),
    origin_confidence: clampScore(rec.origin_confidence),
    fan_overlap_confidence: clampScore(rec.fan_overlap_confidence),
    sound_signal: soundSignal.slice(0, 8),
    evidence: evidence.slice(0, 6),
    source_queries: queries.slice(0, 6),
    validation_note: filter.reason,
    musicbrainz: mb,
    links: {
      spotify: `https://open.spotify.com/search/${encodeURIComponent(rec.name)}`,
      youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.name + ' music')}`,
      lastfm: `https://www.last.fm/music/${encodeURIComponent(rec.name)}`
    }
  };
  normalized.final_score = computeFinalScore(normalized);
  normalized.tier = scoreTier(normalized.final_score, normalized);
  normalized.breakdown = {
    sonido: normalized.sound_confidence,
    origen: normalized.origin_confidence,
    fans: normalized.fan_overlap_confidence,
    match: normalized.similarity_score,
    total: normalized.final_score
  };
  normalized.compare_seed = seed;
  normalized.search_context = { continent, precision };
  return normalized;
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, model: GEMINI_MODEL, lastfm_enabled: Boolean(LASTFM_API_KEY) });
});

app.post('/api/recommend', async (req, res) => {
  try {
    const seed = String(req.body.artist || '').trim();
    const continent = String(req.body.continent || 'all').trim();
    const precision = String(req.body.precision || 'balanced').trim();
    const mode = String(req.body.mode || 'similar').trim();
    const feedbackContext = Array.isArray(req.body.feedbackContext) ? req.body.feedbackContext : [];

    if (!seed) return res.status(400).json({ error: 'Ingresá una banda o artista.' });
    if (!CONTINENTS.has(continent)) return res.status(400).json({ error: 'Continente inválido.' });
    if (!PRECISIONS.has(precision)) return res.status(400).json({ error: 'Precisión inválida.' });
    if (!MODES.has(mode)) return res.status(400).json({ error: 'Modo inválido.' });

    const [lastfmCandidates, seedInfo] = await Promise.all([
      getLastFmSimilar(seed),
      getLastFmInfo(seed)
    ]);

    const llm = await callLlmRecommend({ seed, continent, precision, mode, lastfmCandidates, seedInfo, feedbackContext });
    const recommendations = Array.isArray(llm.parsed?.recommendations) ? llm.parsed.recommendations : [];

    const final = [];
    const rejected = [];
    const seen = new Set([normalizeText(seed)]);

    for (const rec of recommendations) {
      if (!rec?.name) continue;
      const key = normalizeText(rec.name);
      if (!key || seen.has(key)) continue;
      seen.add(key);

      await sleep(180); // Respetar el servicio público de MusicBrainz.
      const mb = await validateWithMusicBrainz(rec.name);
      const filter = postFilterRecommendation(rec, continent, precision, mb);
      if (!filter.keep) {
        rejected.push({ name: rec.name, reason: filter.reason, country: rec.country || mb?.country || '', musicbrainz: mb });
        continue;
      }

      final.push(normalizeRecommendation(rec, seed, continent, precision, mb, filter));
    }

    final.sort((a, b) => b.final_score - a.final_score);

    res.json({
      seed,
      continent,
      continent_label: toDisplayContinent(continent),
      precision,
      mode,
      detected_scene: Array.isArray(llm.parsed?.detected_scene) ? llm.parsed.detected_scene : [],
      debug_notes: Array.isArray(llm.parsed?.debug_notes) ? llm.parsed.debug_notes : [],
      lastfm_candidates_used: lastfmCandidates.length,
      seed_info: seedInfo,
      sources: llm.sources,
      rejected: rejected.slice(0, 12),
      recommendations: final.slice(0, 14)
    });
  } catch (error) {
    console.error('Error en recomendación:', error);
    res.status(500).json({ error: error.message || 'Error inesperado.' });
  }
});

app.post('/api/explain-missing', async (req, res) => {
  try {
    const seed = String(req.body.artist || '').trim();
    const missingArtist = String(req.body.missingArtist || '').trim();
    const continent = String(req.body.continent || 'all').trim();
    const precision = String(req.body.precision || 'balanced').trim();

    if (!seed || !missingArtist) return res.status(400).json({ error: 'Ingresá la banda base y el artista que esperabas ver.' });
    if (!CONTINENTS.has(continent)) return res.status(400).json({ error: 'Continente inválido.' });

    const [seedInfo, missingInfo, mb] = await Promise.all([
      getLastFmInfo(seed),
      getLastFmInfo(missingArtist),
      validateWithMusicBrainz(missingArtist)
    ]);

    const prompt = `
Sos un analista de recomendaciones musicales.
El usuario buscó artistas parecidos a "${seed}" filtrando por ${toDisplayContinent(continent)} (${continent}) con precisión ${precision}.
El usuario esperaba ver a "${missingArtist}" y quiere saber por qué no apareció y si debería aparecer.

Usá búsqueda web y metadata pública. Separá:
- parecido sonoro
- escucha cruzada/fans also listen/similar artists
- origen y continente
- posible motivo técnico por el que no apareció: no estaba en Last.fm, falta país, nombre ambiguo, evidencia baja, filtro estricto, etc.

Contexto Last.fm artista base:
${seedInfo ? JSON.stringify(seedInfo, null, 2) : 'Sin datos'}

Contexto Last.fm artista esperado:
${missingInfo ? JSON.stringify(missingInfo, null, 2) : 'Sin datos'}

MusicBrainz para artista esperado:
${mb ? JSON.stringify(mb, null, 2) : 'Sin datos'}

Devolvé SOLO JSON válido:
{
  "seed": "${seed}",
  "missing_artist": "${missingArtist}",
  "country": "país",
  "continent": "continente id",
  "should_have_appeared": true,
  "sound_match": 0,
  "origin_confidence": 0,
  "fan_overlap_confidence": 0,
  "likely_reason_not_shown": "explicación concreta",
  "recommendation": "qué ajustar o qué modo usar",
  "evidence": ["evidencia 1", "evidencia 2", "evidencia 3"],
  "next_search_queries": ["query 1", "query 2"]
}
`;

    const llm = await callGeminiJson(prompt, 0.1);
    res.json({ ...llm.parsed, musicbrainz: mb, sources: llm.sources });
  } catch (error) {
    console.error('Error en explain-missing:', error);
    res.status(500).json({ error: error.message || 'Error inesperado.' });
  }
});

app.post('/api/compare', async (req, res) => {
  try {
    const seed = String(req.body.artist || '').trim();
    const candidate = String(req.body.candidate || '').trim();
    const continent = String(req.body.continent || 'all').trim();

    if (!seed || !candidate) return res.status(400).json({ error: 'Faltan artista base o candidato.' });

    const [seedInfo, candidateInfo, mb] = await Promise.all([
      getLastFmInfo(seed),
      getLastFmInfo(candidate),
      validateWithMusicBrainz(candidate)
    ]);

    const prompt = `
Compará musicalmente a "${seed}" con "${candidate}" para una app de recomendación.
El usuario filtró por continente: ${toDisplayContinent(continent)} (${continent}).

Analizá con búsqueda web y metadata pública:
- rasgos sonoros en común
- diferencias
- señales de fans/escucha cruzada o listas de similares
- origen del candidato
- si realmente vale la pena recomendarlo

Last.fm ${seed}: ${seedInfo ? JSON.stringify(seedInfo, null, 2) : 'Sin datos'}
Last.fm ${candidate}: ${candidateInfo ? JSON.stringify(candidateInfo, null, 2) : 'Sin datos'}
MusicBrainz ${candidate}: ${mb ? JSON.stringify(mb, null, 2) : 'Sin datos'}

Devolvé SOLO JSON válido:
{
  "seed": "${seed}",
  "candidate": "${candidate}",
  "verdict": "frase breve",
  "score_estimate": 0,
  "common_traits": ["rasgo 1", "rasgo 2"],
  "differences": ["diferencia 1", "diferencia 2"],
  "fan_overlap": "evidencia breve",
  "origin_note": "origen/continente",
  "recommendation_use": "Muy recomendado / Buena coincidencia / Experimental / No recomendado",
  "evidence": ["evidencia 1", "evidencia 2"]
}
`;

    const llm = await callGeminiJson(prompt, 0.12);
    res.json({ ...llm.parsed, musicbrainz: mb, sources: llm.sources });
  } catch (error) {
    console.error('Error en compare:', error);
    res.status(500).json({ error: error.message || 'Error inesperado.' });
  }
});

app.listen(PORT, () => {
  console.log(`SoundMatch LLM Agent listo en http://localhost:${PORT}`);
});

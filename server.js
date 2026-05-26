import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { GoogleGenAI } from '@google/genai';

const app = express();
const PORT = process.env.PORT || 3000;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const LASTFM_API_KEY = process.env.LASTFM_API_KEY || '';

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static('public'));

const CONTINENTS = new Set(['latam', 'europe', 'northamerica', 'africa', 'asia', 'oceania', 'middleeast', 'all']);

const COUNTRY_NAME_TO_CONTINENT = {
  argentina: 'latam', uruguay: 'latam', chile: 'latam', brazil: 'latam', brasil: 'latam', colombia: 'latam', mexico: 'latam', méxico: 'latam', peru: 'latam', perú: 'latam', bolivia: 'latam', paraguay: 'latam', venezuela: 'latam', ecuador: 'latam', cuba: 'latam', 'dominican republic': 'latam', 'puerto rico': 'latam',
  italy: 'europe', italia: 'europe', france: 'europe', francia: 'europe', germany: 'europe', alemania: 'europe', spain: 'europe', españa: 'europe', portugal: 'europe', netherlands: 'europe', 'the netherlands': 'europe', belgium: 'europe', sweden: 'europe', norway: 'europe', denmark: 'europe', finland: 'europe', iceland: 'europe', ireland: 'europe', 'united kingdom': 'europe', uk: 'europe', england: 'europe', scotland: 'europe', wales: 'europe', poland: 'europe', austria: 'europe', switzerland: 'europe', greece: 'europe', turkey: 'middleeast', türkiye: 'middleeast', russia: 'europe', czechia: 'europe', 'czech republic': 'europe', hungary: 'europe', romania: 'europe', serbia: 'europe', croatia: 'europe', slovenia: 'europe', slovakia: 'europe', ukraine: 'europe',
  'united states': 'northamerica', usa: 'northamerica', 'united states of america': 'northamerica', canada: 'northamerica',
  japan: 'asia', japón: 'asia', 'south korea': 'asia', korea: 'asia', china: 'asia', india: 'asia', thailand: 'asia', indonesia: 'asia', philippines: 'asia', vietnam: 'asia', malaysia: 'asia', singapore: 'asia', taiwan: 'asia',
  australia: 'oceania', 'new zealand': 'oceania',
  nigeria: 'africa', ghana: 'africa', senegal: 'africa', mali: 'africa', morocco: 'africa', marruecos: 'africa', egypt: 'africa', sudáfrica: 'africa', 'south africa': 'africa', kenya: 'africa', ethiopia: 'africa', algeria: 'africa', tunisia: 'africa',
  israel: 'middleeast', iran: 'middleeast', iraq: 'middleeast', lebanon: 'middleeast', líbano: 'middleeast', jordan: 'middleeast', syria: 'middleeast', 'saudi arabia': 'middleeast', uae: 'middleeast', 'united arab emirates': 'middleeast'
};

const ISO_TO_CONTINENT = {
  AR:'latam', UY:'latam', CL:'latam', BR:'latam', CO:'latam', MX:'latam', PE:'latam', BO:'latam', PY:'latam', VE:'latam', EC:'latam', CU:'latam', DO:'latam', PR:'latam',
  IT:'europe', FR:'europe', DE:'europe', ES:'europe', PT:'europe', NL:'europe', BE:'europe', SE:'europe', NO:'europe', DK:'europe', FI:'europe', IS:'europe', IE:'europe', GB:'europe', PL:'europe', AT:'europe', CH:'europe', GR:'europe', CZ:'europe', HU:'europe', RO:'europe', RS:'europe', HR:'europe', SI:'europe', SK:'europe', UA:'europe', RU:'europe',
  US:'northamerica', CA:'northamerica',
  JP:'asia', KR:'asia', CN:'asia', IN:'asia', TH:'asia', ID:'asia', PH:'asia', VN:'asia', MY:'asia', SG:'asia', TW:'asia',
  AU:'oceania', NZ:'oceania',
  NG:'africa', GH:'africa', SN:'africa', ML:'africa', MA:'africa', EG:'africa', ZA:'africa', KE:'africa', ET:'africa', DZ:'africa', TN:'africa',
  TR:'middleeast', IL:'middleeast', IR:'middleeast', IQ:'middleeast', LB:'middleeast', JO:'middleeast', SY:'middleeast', SA:'middleeast', AE:'middleeast'
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

function continentFromCountryName(country = '') {
  const key = normalizeText(country);
  if (!key) return '';
  return COUNTRY_NAME_TO_CONTINENT[key] || '';
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
    const url = `https://ws.audioscrobbler.com/2.0/?method=artist.getsimilar&artist=${encodeURIComponent(seed)}&api_key=${LASTFM_API_KEY}&limit=50&format=json`;
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
      tags: (info?.tags?.tag || []).map(t => t.name).slice(0, 12),
      bio: info?.bio?.summary?.replace(/<[^>]+>/g, '').slice(0, 600) || '',
      url: info.url || ''
    };
  } catch (error) {
    return null;
  }
}

async function validateWithMusicBrainz(artistName) {
  try {
    const query = encodeURIComponent(`artist:"${artistName}"`);
    const url = `https://musicbrainz.org/ws/2/artist/?query=${query}&fmt=json&limit=5`;
    const data = await fetchJson(url, {
      headers: { 'User-Agent': 'SoundMatchLLMAgent/1.0 (local-dev@example.com)' }
    });

    const normalized = normalizeText(artistName);
    const artists = data?.artists || [];
    const exact = artists.find(a => normalizeText(a.name) === normalized) || artists[0];
    if (!exact) return null;

    const areaCode = exact?.country || exact?.area?.['iso-3166-1-codes']?.[0] || exact?.['begin-area']?.['iso-3166-1-codes']?.[0] || '';
    const country = exact?.area?.name || exact?.['begin-area']?.name || exact?.country || '';
    const continent = ISO_TO_CONTINENT[areaCode] || continentFromCountryName(country);

    return {
      source: 'MusicBrainz',
      mbid: exact.id,
      country,
      areaCode,
      continent
    };
  } catch (error) {
    console.warn(`MusicBrainz falló para ${artistName}:`, error.message);
    return null;
  }
}

function extractJson(text = '') {
  const cleaned = text.replace(/```json/gi, '```').replace(/```/g, '').trim();
  const first = cleaned.indexOf('{');
  const last = cleaned.lastIndexOf('}');
  if (first === -1 || last === -1 || last <= first) {
    throw new Error('El LLM no devolvió JSON válido.');
  }
  return JSON.parse(cleaned.slice(first, last + 1));
}

async function callLlmAgent({ seed, continent, precision, lastfmCandidates, seedInfo }) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Falta GEMINI_API_KEY en el archivo .env.');
  }

  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const continentLabel = toDisplayContinent(continent);
  const candidatesText = lastfmCandidates.length
    ? lastfmCandidates.slice(0, 50).map((c, i) => `${i + 1}. ${c.name} | Last.fm match: ${c.lastfm_match}`).join('\n')
    : 'No hay candidatos de Last.fm disponibles. Buscá candidatos desde la web.';

  const seedInfoText = seedInfo
    ? `Tags/bio de artista base según Last.fm: ${JSON.stringify(seedInfo, null, 2)}`
    : 'Sin metadata de Last.fm para el artista base.';

  const prompt = `
Sos un agente experto en descubrimiento musical.
Necesito recomendaciones de artistas/bandas que sean realmente parecidos a "${seed}" pero que pertenezcan a este continente seleccionado: ${continentLabel} (${continent}).

Reglas obligatorias:
1. NO uses una base propia inventada. Buscá y uní evidencia pública.
2. Priorizá señales de "fans also listen", "similar artists", escenas compartidas, sellos, reseñas, tags sonoros, subgéneros y comparaciones explícitas.
3. El continente es filtro duro. Si el continente es "europe", artistas de Estados Unidos como The Velvet Underground deben quedar afuera aunque sean muy similares.
4. Si hay artistas europeos muy similares como New Candys para búsquedas tipo Winona Riders/Europa, deberías detectarlos si la evidencia pública los sostiene.
5. No recomiendes artistas si no podés identificar país u origen con confianza suficiente.
6. No priorices popularidad. Priorizá parecido sonoro y relación de escucha.
7. La respuesta tiene que ser SOLO JSON válido. Sin markdown, sin texto antes ni después.

Modo de precisión: ${precision}.
- strict: país/continente confirmado por evidencia fuerte.
- balanced: país confirmado o evidencia pública consistente.
- exploratory: acepta evidencia razonable, pero marcá confidence menor.

Contexto del artista base:
${seedInfoText}

Candidatos iniciales de Last.fm, si existen:
${candidatesText}

Devolvé este JSON exacto:
{
  "seed": "${seed}",
  "selected_continent": "${continent}",
  "recommendations": [
    {
      "name": "Nombre del artista",
      "country": "País de origen",
      "continent": "${continent}",
      "similarity_score": 0,
      "origin_confidence": 0,
      "sound_confidence": 0,
      "fan_signal": "evidencia breve de escucha cruzada o artistas similares",
      "sound_signal": ["tag o rasgo sonoro 1", "tag o rasgo sonoro 2"],
      "origin_signal": "evidencia breve del origen",
      "why": "por qué encaja con ${seed}",
      "source_queries": ["queries o fuentes consultadas"],
      "warning": "vacío si no hay advertencias"
    }
  ]
}

Devuelve entre 8 y 12 recomendaciones si hay evidencia suficiente.
Puntajes: similarity_score, origin_confidence y sound_confidence de 0 a 100.
`;

  const response = await ai.models.generateContent({
    model: GEMINI_MODEL,
    contents: prompt,
    config: {
      tools: [{ googleSearch: {} }],
      temperature: 0.15
    }
  });

  const parsed = extractJson(response.text || '');
  const grounding = response?.candidates?.[0]?.groundingMetadata || {};
  const sources = (grounding.groundingChunks || [])
    .map((chunk, index) => ({ index: index + 1, title: chunk?.web?.title || '', url: chunk?.web?.uri || '' }))
    .filter(s => s.url);

  return { parsed, sources, rawText: response.text };
}

function postFilterRecommendation(rec, selectedContinent, precision, mbValidation) {
  if (selectedContinent === 'all') return { keep: true, reason: 'Sin filtro de continente.' };

  const recCountryContinent = continentFromCountryName(rec.country || '');
  const recContinent = rec.continent || recCountryContinent;
  const mbContinent = mbValidation?.continent || '';

  const llmMatches = recContinent === selectedContinent || recCountryContinent === selectedContinent;
  const mbMatches = mbContinent === selectedContinent;

  if (precision === 'strict') {
    if (mbMatches || (llmMatches && Number(rec.origin_confidence || 0) >= 80)) {
      return { keep: true, reason: mbMatches ? 'Continente validado con MusicBrainz.' : 'Continente validado por evidencia del LLM.' };
    }
    return { keep: false, reason: 'No se pudo validar continente en modo estricto.' };
  }

  if (precision === 'balanced') {
    if (mbMatches || llmMatches || Number(rec.origin_confidence || 0) >= 70) {
      return { keep: true, reason: mbMatches ? 'Continente validado con MusicBrainz.' : 'Continente sostenido por evidencia pública.' };
    }
    return { keep: false, reason: 'La evidencia de continente es baja.' };
  }

  if (mbMatches || llmMatches || Number(rec.origin_confidence || 0) >= 55) {
    return { keep: true, reason: mbMatches ? 'Continente validado con MusicBrainz.' : 'Continente probable según evidencia pública.' };
  }

  return { keep: false, reason: 'Continente demasiado incierto.' };
}

app.post('/api/recommend', async (req, res) => {
  try {
    const seed = String(req.body.artist || '').trim();
    const continent = String(req.body.continent || 'all').trim();
    const precision = String(req.body.precision || 'balanced').trim();

    if (!seed) return res.status(400).json({ error: 'Ingresá una banda o artista.' });
    if (!CONTINENTS.has(continent)) return res.status(400).json({ error: 'Continente inválido.' });

    const [lastfmCandidates, seedInfo] = await Promise.all([
      getLastFmSimilar(seed),
      getLastFmInfo(seed)
    ]);

    const llm = await callLlmAgent({ seed, continent, precision, lastfmCandidates, seedInfo });
    const recommendations = Array.isArray(llm.parsed?.recommendations) ? llm.parsed.recommendations : [];

    const final = [];
    for (const rec of recommendations) {
      if (!rec?.name) continue;
      await sleep(250); // Respetar el servicio público de MusicBrainz.
      const mb = await validateWithMusicBrainz(rec.name);
      const filter = postFilterRecommendation(rec, continent, precision, mb);
      if (!filter.keep) continue;

      final.push({
        ...rec,
        similarity_score: Math.max(0, Math.min(100, Number(rec.similarity_score || 0))),
        origin_confidence: Math.max(0, Math.min(100, Number(rec.origin_confidence || 0))),
        sound_confidence: Math.max(0, Math.min(100, Number(rec.sound_confidence || 0))),
        validation_note: filter.reason,
        musicbrainz: mb,
        links: {
          spotify: `https://open.spotify.com/search/${encodeURIComponent(rec.name)}`,
          youtube: `https://www.youtube.com/results?search_query=${encodeURIComponent(rec.name + ' music')}`,
          lastfm: `https://www.last.fm/music/${encodeURIComponent(rec.name)}`
        }
      });
    }

    final.sort((a, b) => {
      const scoreA = (a.similarity_score * 0.55) + (a.sound_confidence * 0.25) + (a.origin_confidence * 0.20);
      const scoreB = (b.similarity_score * 0.55) + (b.sound_confidence * 0.25) + (b.origin_confidence * 0.20);
      return scoreB - scoreA;
    });

    res.json({
      seed,
      continent,
      precision,
      lastfm_candidates_used: lastfmCandidates.length,
      sources: llm.sources,
      recommendations: final.slice(0, 12)
    });
  } catch (error) {
    console.error('Error en recomendación:', error);
    res.status(500).json({ error: error.message || 'Error inesperado.' });
  }
});

app.listen(PORT, () => {
  console.log(`SoundMatch LLM Agent listo en http://localhost:${PORT}`);
});

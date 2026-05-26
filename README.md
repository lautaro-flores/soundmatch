# SoundMatch LLM Agent

Esta version no usa una base propia. Usa un backend que combina:

- Last.fm, opcional, para señal de artistas similares / fans que escuchan A tambien escuchan B.
- MusicBrainz, gratis, para validar origen cuando la metadata existe.
- Gemini con Google Search grounding para buscar, unir evidencias y rankear recomendaciones.

## Instalacion

```bash
npm install
cp .env.example .env
```

Editá `.env` y agregá tu `GEMINI_API_KEY`. Opcionalmente agregá `LASTFM_API_KEY`.

## Ejecutar

```bash
npm run dev
```

Abrí:

```text
http://localhost:3000
```

## Por qué necesita backend

No conviene llamar al LLM desde el HTML directo porque expondrías tu API key. El frontend llama a `/api/recommend` y el backend hace la búsqueda.

## Cómo ajusta mejor el continente

El LLM debe devolver país + continente + evidencia. Luego el backend vuelve a validar con MusicBrainz y mapas de país/continente. En modo `strict`, si no puede sostener el continente, descarta el artista.

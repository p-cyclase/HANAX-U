# Singer Mapping Design

## Purpose

HANAX-U converts speech-project prosody into OpenUtau notes. The future singer-mapping feature will let a user choose which locally installed OpenUtau singer should be assigned to each imported source speaker and style.

This feature does not attempt to discover installed voicebanks from the browser or infer a compatible UTAU singer automatically.

## Conversion pipeline

```text
Importer -> ProsodyProject -> Generator -> NoteSequence -> Exporter -> USTX
```

- The Importer preserves source-speaker metadata with each dialogue line.
- The Generator creates lyrics, timing, pitch, rests, and portamento without selecting a singer.
- The Exporter applies the saved singer mapping to the USTX track.

## Source speaker identity

For COEIROINK imports, every dialogue line retains:

- `speaker_uuid`
- `style_id`
- `speaker_name`
- `style_name`
- `speaker_id`: the stable key `${speaker_uuid}:${style_id}`

`speaker_id` is the mapping key. The names are for display and fallback identification only, because a speaker can have multiple styles and names are not guaranteed to be unique.

The UI label is:

```text
話者（スタイル名）
```

For example: `つくよみちゃん（れいせい）`.

## Mapping profile

The user creates one output profile per source `speaker_id`.

```text
source speaker_id
  -> singer: free-text OpenUtau singer name
  -> phonemizer: one of two supported choices
  -> renderer: one of two supported choices
```

### `singer`

The value is a free-text field. It must match the singer name or path recognized by the user’s local OpenUtau installation. A browser application cannot reliably enumerate that installation.

### `phonemizer`

Supported choices:

- `OpenUtau.Core.DefaultPhonemizer`
- `OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer`

### `renderer`

Supported choices:

- `CLASSIC`
- `WORLDLINE-R`

The renderer is written as `renderer_settings.renderer` in the USTX track.

## USTX output policy

For a mapped source speaker, the Exporter writes only the user-selected portable fields:

```yaml
singer: example singer
phonemizer: OpenUtau.Core.DefaultPhonemizer
renderer_settings:
  renderer: CLASSIC
```

The Exporter must not write `resampler`, `wavtool`, or `voice_color_names`. OpenUtau can then use settings appropriate to the singer available in the local environment.

If a source speaker has no mapping, the Exporter keeps the current safe behavior: it omits `singer` and does not invent singer-specific settings.

## Scope of a mapping

The current converter makes one OpenUtau track per imported dialogue line. Therefore a speaker profile applies to every output track whose imported `speaker_id` matches it.

If users later need different singers for lines from the same source speaker, add a separate per-line override. That override should take precedence over the speaker-profile mapping.

## UI behavior

After a source file has been imported, the output settings show one mapping row for each unique source `speaker_id`. Each row displays `話者（スタイル名）`, accepts a free-text singer name, and provides the two supported phonemizer and renderer choices. Changing a row immediately refreshes the conversion preview and the pending USTX download.

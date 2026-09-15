/**
 * converter.js - HANAX-U コンバータ (Fujisaki Model Pitch Engine & OpenUtau .ustx Exporter)
 * Strictly matches official OpenUtau project file schema (v0.7).
 */

const TONE_LOW = 58;   // A#3
const TONE_MID = 60;   // C4
const TONE_HIGH = 63;  // D#4
const REST_TONE = 60;  // Fallback tone for rests
const MORA_TICKS = 240; // 8th note (240 ticks)

const SOKUON_CHARS = new Set(["っ", "ッ"]);
const QUESTION_CHARS = new Set(["？", "?"]);
const COMMA_CHARS = new Set(["、", ","]);
const PUNCTUATION_CHARS = new Set(["。", ".", "！", "!"]);

const DEFAULT_EXPRESSIONS = {
    dyn: { name: "dynamics (curve)", abbr: "dyn", type: "Curve", min: -240, max: 120, default_value: 0, is_flag: false, flag: "" },
    pitd: { name: "pitch deviation (curve)", abbr: "pitd", type: "Curve", min: -1200, max: 1200, default_value: 0, is_flag: false, flag: "" },
    clr: { name: "voice color", abbr: "clr", type: "Options", min: 0, max: -1, default_value: 0, is_flag: false, options: [] },
    eng: { name: "resampler engine", abbr: "eng", type: "Options", min: 0, max: 1, default_value: 0, is_flag: false, options: ["", "worldline"] },
    vel: { name: "velocity", abbr: "vel", type: "Numerical", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
    vol: { name: "volume", abbr: "vol", type: "Numerical", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
    atk: { name: "attack", abbr: "atk", type: "Numerical", min: 0, max: 200, default_value: 100, is_flag: false, flag: "" },
    dec: { name: "decay", abbr: "dec", type: "Numerical", min: 0, max: 100, default_value: 0, is_flag: false, flag: "" },
    gen: { name: "gender", abbr: "gen", type: "Numerical", min: -100, max: 100, default_value: 0, is_flag: true, flag: "g" },
    genc: { name: "gender (curve)", abbr: "genc", type: "Curve", min: -100, max: 100, default_value: 0, is_flag: false, flag: "" },
    bre: { name: "breath", abbr: "bre", type: "Numerical", min: 0, max: 100, default_value: 0, is_flag: true, flag: "B" },
    brec: { name: "breathiness (curve)", abbr: "brec", type: "Curve", min: -100, max: 100, default_value: 0, is_flag: false, flag: "" },
    lpf: { name: "lowpass", abbr: "lpf", type: "Numerical", min: 0, max: 100, default_value: 0, is_flag: true, flag: "H" },
    norm: { name: "normalize", abbr: "norm", type: "Numerical", min: 0, max: 100, default_value: 50, is_flag: true, flag: "P" },
    mod: { name: "modulation", abbr: "mod", type: "Numerical", min: 0, max: 100, default_value: 0, is_flag: false, flag: "" },
    "mod+": { name: "modulation plus", abbr: "mod+", type: "Numerical", min: 0, max: 100, default_value: 0, is_flag: false, flag: "" },
    alt: { name: "alternate", abbr: "alt", type: "Numerical", min: 0, max: 16, default_value: 0, is_flag: false, flag: "" },
    dir: { name: "direct", abbr: "dir", type: "Options", min: 0, max: 1, default_value: 0, is_flag: false, options: ["off", "on"] },
    shft: { name: "tone shift", abbr: "shft", type: "Numerical", min: -36, max: 36, default_value: 0, is_flag: false, flag: "" },
    shfc: { name: "tone shift (curve)", abbr: "shfc", type: "Curve", min: -1200, max: 1200, default_value: 0, is_flag: false, flag: "" },
    tenc: { name: "tension (curve)", abbr: "tenc", type: "Curve", min: -100, max: 100, default_value: 0, is_flag: false, flag: "" },
    voic: { name: "voicing (curve)", abbr: "voic", type: "Curve", min: 0, max: 100, default_value: 100, is_flag: false, flag: "" }
};

function sanitizeText(text) {
    if (!text) return "";
    return String(text).replace(/\uFFFD/g, '').trim();
}

/**
 * Fujisaki Model Impulse Response G_p(t)
 */
function fujisakiPhraseResponse(t, alpha = 3.0) {
    if (t < 0) return 0.0;
    return (alpha * alpha) * t * Math.exp(-alpha * t);
}

/**
 * Fujisaki Model Step Response G_a(t)
 */
function fujisakiAccentResponse(t, beta = 20.0, gamma = 0.9) {
    if (t < 0) return 0.0;
    const val = 1.0 - (1.0 + beta * t) * Math.exp(-beta * t);
    return Math.min(val, gamma);
}

/**
 * Computes Fujisaki F0 fundamental frequency for each mora in line.
 */
function computeFujisakiPitchesForLine(line, bpm = 180, alpha = 3.0, beta = 20.0, fbHz = 150.0) {
    const accentPhrases = line.accent_phrases || [];
    const moraDurationSec = (60.0 / Number(bpm)) * 0.5;

    const timelineMoras = [];
    let currentTime = 0.0;
    const phraseCommandTimes = [0.0];

    accentPhrases.forEach((ap, apIdx) => {
        const moras = ap.moras || [];
        moras.forEach(mora => {
            const text = mora.text || mora.hira || "";
            timelineMoras.push({
                mora: mora,
                startTime: currentTime,
                text: text,
                accent: mora.accent || 0
            });
            currentTime += moraDurationSec;

            if (COMMA_CHARS.has(text) || PUNCTUATION_CHARS.has(text)) {
                phraseCommandTimes.push(currentTime);
            }
        });

        const pauseSec = ap.pause_sec || 0;
        if ((pauseSec > 0.05 || ap.pause_mora) && apIdx < accentPhrases.length - 1) {
            phraseCommandTimes.push(currentTime);
        }
    });

    const logFb = Math.log(fbHz);
    const apMag = 0.35;
    const aaMag = 0.45;

    const results = [];
    timelineMoras.forEach(item => {
        const t = item.startTime + (moraDurationSec / 2.0);

        let pT = 0.0;
        phraseCommandTimes.forEach(tP => {
            if (t >= tP) {
                pT += apMag * fujisakiPhraseResponse(t - tP, alpha);
            }
        });

        let aT = 0.0;
        timelineMoras.forEach(other => {
            if (other.accent === 1) {
                const t1 = other.startTime;
                const t2 = t1 + moraDurationSec;
                if (t >= t1) {
                    aT += aaMag * (fujisakiAccentResponse(t - t1, beta) - fujisakiAccentResponse(t - t2, beta));
                }
            }
        });

        const logF0 = logFb + pT + aT;
        const f0Hz = Math.exp(logF0);
        results.push({ mora: item.mora, f0Hz: f0Hz });
    });

    return results;
}

function quantizeFujisakiPitches(f0List) {
    const valid = f0List.filter(f => f > 0);
    if (valid.length === 0) return new Map();

    const sorted = [...valid].sort((a, b) => a - b);
    const n = sorted.length;
    const mapping = new Map();

    if (n === 1 || sorted[0] === sorted[n - 1]) {
        sorted.forEach(f => mapping.set(f, TONE_MID));
        return mapping;
    }

    let f33 = sorted[Math.floor(n / 3)];
    let f67 = sorted[Math.floor((2 * n) / 3)];

    if (f33 === f67) {
        const minF = sorted[0];
        const maxF = sorted[n - 1];
        f33 = minF + (maxF - minF) / 3.0;
        f67 = minF + (2.0 * (maxF - minF)) / 3.0;
    }

    const uniqueF = new Set(valid);
    uniqueF.forEach(f => {
        if (f < f33) {
            mapping.set(f, TONE_LOW);
        } else if (f < f67) {
            mapping.set(f, TONE_MID);
        } else {
            mapping.set(f, TONE_HIGH);
        }
    });

    return mapping;
}

/** Stage 1: import a source project into format-neutral prosody data. */
function importCinkToProsodyProject(cinkData) {
    const lines = parseDialogueLines(cinkData);
    if (!lines || lines.length === 0) {
        throw new Error("入力されたCOEIROINKデータ内に有効なセリフ（アクセント句）が見つかりませんでした。");
    }
    return { sourceFormat: "coeiroink", lines };
}

function resolvePitchOptions(options = {}) {
    const bpm = options.bpm !== undefined ? options.bpm : 180;
    // portamentoLength is retained only for callers of the former tick-based
    // API; USTX pitch-point x values and the UI now use milliseconds.
    const portamentoLengthMs = options.portamentoLengthMs !== undefined
        ? options.portamentoLengthMs
        : options.portamentoLength !== undefined
            ? options.portamentoLength * 60000 / bpm / 480
            : 60;
    const alpha = options.alpha !== undefined ? options.alpha : 3.0;
    const beta = options.beta !== undefined ? options.beta : 20.0;
    const fbHz = options.fbHz !== undefined ? options.fbHz : 150.0;
    return { bpm, portamentoLengthMs, alpha, beta, fbHz };
}

function resolveExportOptions(options = {}) {
    const normalize = Number.isFinite(options.normalize)
        ? Math.max(0, Math.min(100, options.normalize))
        : 50;
    const singerMappings = options.singerMappings && typeof options.singerMappings === "object"
        ? options.singerMappings
        : {};
    return { normalize, singerMappings };
}

const SUPPORTED_PHONEMIZERS = new Set([
    "OpenUtau.Core.DefaultPhonemizer",
    "OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer"
]);
const SUPPORTED_RENDERERS = new Set(["CLASSIC", "WORLDLINE-R"]);

function resolveSingerMapping(line, singerMappings) {
    const mapping = singerMappings[line.speaker_id];
    const singer = typeof mapping?.singer === "string" ? mapping.singer.trim() : "";
    if (!singer) return null;
    return {
        singer,
        phonemizer: SUPPORTED_PHONEMIZERS.has(mapping.phonemizer)
            ? mapping.phonemizer
            : "OpenUtau.Core.DefaultPhonemizer",
        renderer: SUPPORTED_RENDERERS.has(mapping.renderer) ? mapping.renderer : "CLASSIC"
    };
}

/** Stage 2: turn prosody data into a format-neutral note sequence. */
function generateNoteSequence(prosodyProject, options = {}) {
    const pitchOptions = resolvePitchOptions(options);
    const lines = prosodyProject.lines;
    const noteParts = [];
    let totalNotesCount = 0;
    const pitchStats = { semitone: 0, rest: 0, phraseResets: 0, f0Min: 999, f0Max: 0 };

    lines.forEach((line, idx) => {
        const partName = line.text || `Line ${idx + 1}`;
        const notes = buildNotesForDialogue(line, pitchOptions.portamentoLengthMs, pitchOptions.bpm,
            pitchOptions.alpha, pitchOptions.beta, pitchOptions.fbHz, pitchStats);
        totalNotesCount += notes.length;
        const partDuration = notes.length > 0 ? (notes[notes.length - 1].position + notes[notes.length - 1].duration) : 0;
        noteParts.push({ name: partName, duration: partDuration, notes });
    });

    return {
        sourceFormat: prosodyProject.sourceFormat,
        lines,
        options: pitchOptions,
        noteParts,
        stats: { lineCount: lines.length, totalNotes: totalNotesCount, pitchStats, lines }
    };
}

/** Stage 3: export a note sequence as an OpenUtau USTX project. */
function exportNoteSequenceToUstx(noteSequence, options = {}) {
    const { bpm } = noteSequence.options;
    const exportOptions = resolveExportOptions(options);
    const tracks = noteSequence.noteParts.map((_, idx) => {
        const mapping = resolveSingerMapping(noteSequence.lines[idx], exportOptions.singerMappings);
        return {
            ...(mapping ? { singer: mapping.singer } : {}),
            phonemizer: mapping?.phonemizer || "OpenUtau.Core.DefaultPhonemizer",
            renderer_settings: mapping ? { renderer: mapping.renderer } : {},
            track_name: String(idx + 1).padStart(3, "0"),
            track_color: "Blue",
            mute: false,
            solo: false,
            volume: 0,
            pan: 0,
            track_expressions: []
        };
    });
    const voiceParts = noteSequence.noteParts.map((part, idx) => ({
        duration: part.duration,
        name: part.name,
        comment: "",
        track_no: idx,
        position: 0,
        notes: part.notes,
        curves: []
    }));

    const ustxDict = {
        name: "HANAX-U Export",
        comment: "",
        output_dir: "Vocal",
        cache_dir: "UCache",
        ustx_version: "0.7",
        resolution: 480,
        bpm: bpm,
        beat_per_bar: 4,
        beat_unit: 4,
        expressions: {
            ...DEFAULT_EXPRESSIONS,
            norm: { ...DEFAULT_EXPRESSIONS.norm, default_value: exportOptions.normalize }
        },
        exp_selectors: [
            "dyn", "pitd", "clr", "eng", "vel", "vol", "atk", "dec", "gen", "bre"
        ],
        exp_primary: 0,
        exp_secondary: 1,
        key: 0,
        time_signatures: [
            {
                bar_position: 0,
                beat_per_bar: 4,
                beat_unit: 4
            }
        ],
        tempos: [
            {
                position: 0,
                bpm: bpm
            }
        ],
        tracks: tracks,
        voice_parts: voiceParts,
        wave_parts: []
    };

    const ustxYaml = generateUstxYaml(ustxDict);
    return { ustxDict, ustxYaml };
}

/** Backward-compatible application entry point composed from the three stages. */
function convertCinkToUstx(cinkData, options = {}) {
    const prosodyProject = importCinkToProsodyProject(cinkData);
    const noteSequence = generateNoteSequence(prosodyProject, options);
    return { ...exportNoteSequenceToUstx(noteSequence, options), stats: noteSequence.stats };
}

function parseDialogueLines(data) {
    const lines = [];

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        if (Array.isArray(data.textBoxes)) {
            data.textBoxes.forEach((tb, idx) => {
                if (typeof tb === 'object' && tb !== null) {
                    const rawText = tb.text || tb.plain_text || `Line_${String(idx + 1).padStart(4, "0")}`;
                    const text = sanitizeText(rawText) || `Line_${String(idx + 1).padStart(4, "0")}`;
                    const speakerIdentity = extractSpeakerIdentity(tb);
                    const prosody = tb.prosodyDetail || tb.accent_phrases || [];
                    const accentPhrases = normalizeAccentPhrases(prosody) || [];

                    lines.push({
                        ...speakerIdentity,
                        text: text,
                        accent_phrases: accentPhrases.length > 0 ? accentPhrases : makeAccentPhrasesFromText(text),
                        pause_len: tb.pauseLength
                    });
                }
            });
        } else if (data.audioQueryMap) {
            const queryMap = data.audioQueryMap || {};
            const textMap = data.textMap || {};
            const keys = data.audioKeys || Object.keys(queryMap);
            keys.forEach((key, idx) => {
                const query = queryMap[key] || {};
                const text = sanitizeText(textMap[key] || query.text || `Line ${idx + 1}`);
                const speakerIdentity = extractSpeakerIdentity(query);
                lines.push({
                    ...speakerIdentity,
                    text: text,
                    accent_phrases: normalizeAccentPhrases(query.accent_phrases || query.prosodyDetail)
                });
            });
        } else if (data.accent_phrases || data.prosodyDetail) {
            lines.push(extractDialogueItem(data, 0));
        } else if (data.tracks || data.audio_items || data.block_list || data.speaker_blocks) {
            const blocks = data.tracks || data.audio_items || data.block_list || data.speaker_blocks || [];
            blocks.forEach((block, idx) => {
                lines.push(extractDialogueItem(block, idx));
            });
        } else {
            Object.keys(data).forEach(key => {
                const val = data[key];
                if (val && typeof val === 'object' && (val.accent_phrases || val.prosodyDetail)) {
                    lines.push({
                        ...extractSpeakerIdentity(val),
                        text: sanitizeText(val.text || key),
                        accent_phrases: normalizeAccentPhrases(val.accent_phrases || val.prosodyDetail)
                    });
                }
            });
        }
    } else if (Array.isArray(data)) {
        data.forEach((item, idx) => {
            if (typeof item === 'object' && item !== null) {
                lines.push(extractDialogueItem(item, idx));
            }
        });
    }

    return lines.filter(l => l && l.text && l.accent_phrases && l.accent_phrases.length > 0);
}

function normalizeAccentPhrases(prosody) {
    if (!Array.isArray(prosody)) return [];
    const result = [];
    prosody.forEach(phrase => {
        if (Array.isArray(phrase)) {
            const moras = [];
            phrase.forEach(m => {
                if (typeof m === 'object' && m !== null) {
                    const hira = sanitizeText(m.hira || m.text || m.phoneme || "");
                    moras.push({
                        text: hira,
                        pitch: m.pitch || m.f0,
                        accent: m.accent || 0,
                        phoneme: m.phoneme || ""
                    });
                }
            });
            if (moras.length > 0) {
                result.push({ moras: moras });
            }
        } else if (typeof phrase === 'object' && phrase !== null) {
            result.push(phrase);
        }
    });
    return result;
}

function extractDialogueItem(item, idx) {
    const text = sanitizeText(item.text || item.plain_text || item.title || `Line_${String(idx + 1).padStart(4, "0")}`);
    let accentPhrases = item.accent_phrases || item.prosodyDetail;
    if (!accentPhrases && item.audio_query) accentPhrases = item.audio_query.accent_phrases || item.audio_query.prosodyDetail;
    if (!accentPhrases && item.query) accentPhrases = item.query.accent_phrases || item.query.prosodyDetail;

    return {
        ...extractSpeakerIdentity(item),
        text: text,
        accent_phrases: (() => {
            const normalized = normalizeAccentPhrases(accentPhrases);
            return normalized.length > 0 ? normalized : makeAccentPhrasesFromText(text);
        })()
    };
}

function extractSpeakerIdentity(source) {
    const speakerName = sanitizeText(source.speakerName || source.speaker_name || "");
    const styleName = sanitizeText(source.styleName || source.style_name || "");
    const speakerUuid = sanitizeText(source.speakerUuid || source.speaker_uuid || "");
    const rawStyleId = source.styleId !== undefined ? source.styleId : source.style_id;
    const styleId = rawStyleId === undefined || rawStyleId === null || rawStyleId === "" ? null : rawStyleId;
    return {
        speaker_name: speakerName,
        speaker_uuid: speakerUuid,
        style_id: styleId,
        style_name: styleName,
        speaker_id: speakerUuid && styleId !== null ? `${speakerUuid}:${styleId}` : ""
    };
}

// INI-format .cink files may contain only the entered text. Preserve that
// dialogue rather than rejecting the project; each visible character becomes
// a provisional mora and can still be edited in OpenUtau afterwards.
function makeAccentPhrasesFromText(text) {
    const moras = Array.from(text)
        .filter(char => !/\s/.test(char))
        .map(char => ({ text: char, pitch: null, accent: 0, phoneme: '' }));
    return moras.length > 0 ? [{ moras }] : [];
}

/**
 * Builds array of notes for a dialogue line using Fujisaki Model Pitch Engine.
 */
function buildNotesForDialogue(line, portamentoLengthMs, bpm, alpha, beta, fbHz, pitchStats) {
    const accentPhrases = line.accent_phrases || [];
    const fujisakiResults = computeFujisakiPitchesForLine(line, bpm, alpha, beta, fbHz);
    const f0Values = fujisakiResults.map(r => r.f0Hz);
    const moraEvents = accentPhrases.flatMap((phrase, phraseIndex) =>
        (phrase.moras || []).map(mora => ({ mora, phraseIndex }))
    );

    f0Values.forEach(f => {
        if (f < pitchStats.f0Min) pitchStats.f0Min = Math.round(f);
        if (f > pitchStats.f0Max) pitchStats.f0Max = Math.round(f);
    });

    const notes = [];
    let currentPos = 0;

    const nextVoicedMidi = (startIndex) => {
        for (let index = startIndex; index < moraEvents.length; index++) {
            const text = moraEvents[index].mora.text || moraEvents[index].mora.hira || "";
            if (!isRestText(text)) return hzToMidi(f0Values[index] || fbHz);
        }
        return null;
    };

    // Keep the original low-start policy, but place the rest relative to the
    // first voiced note so it belongs to the same continuous contour.
    let prevRenderedMidi = chooseRestMidi("leading", null, nextVoicedMidi(0), hzToMidi(f0Values[0] || fbHz));
    const leadingRest = createNoteObject(currentPos, MORA_TICKS, prevRenderedMidi, "R", null, portamentoLengthMs);
    notes.push(leadingRest);
    currentPos += MORA_TICKS;
    prevRenderedMidi = leadingRest.tone;
    let prevSungMidi = null;
    let prevMoraAccented = false;
    pitchStats.rest++;

    let fujisakiIdx = 0;
    accentPhrases.forEach((ap, apIdx) => {
        const moras = ap.moras || [];
        moras.forEach((mora, mIdx) => {
            const text = mora.text || mora.hira || "";
            const accent = mora.accent || 0;

            const f0 = f0Values[fujisakiIdx] !== undefined ? f0Values[fujisakiIdx] : fbHz;
            fujisakiIdx++;

            let lyric, midiPitch;
            const nextMidi = nextVoicedMidi(fujisakiIdx);

            if (SOKUON_CHARS.has(text)) {
                lyric = "R";
                midiPitch = chooseRestMidi("high", prevSungMidi, nextMidi, hzToMidi(f0));
                prevMoraAccented = true;
                pitchStats.rest++;
            } else if (QUESTION_CHARS.has(text)) {
                lyric = "R";
                midiPitch = chooseRestMidi("high", prevSungMidi, nextMidi, hzToMidi(f0));
                prevMoraAccented = true;
                pitchStats.rest++;
            } else if (COMMA_CHARS.has(text)) {
                lyric = "R";
                midiPitch = chooseRestMidi(prevMoraAccented ? "high" : "low", prevSungMidi, nextMidi, hzToMidi(f0));
                prevMoraAccented = false;
                pitchStats.rest++;
                pitchStats.phraseResets++;
            } else if (PUNCTUATION_CHARS.has(text) || !text) {
                lyric = "R";
                midiPitch = chooseRestMidi("low", prevSungMidi, nextMidi, hzToMidi(f0));
                prevMoraAccented = false;
                pitchStats.rest++;
                pitchStats.phraseResets++;
            } else {
                lyric = text;
                midiPitch = hzToMidi(f0);
                prevSungMidi = midiPitch;
                prevMoraAccented = accent === 1;
                pitchStats.semitone++;
            }

            const note = createNoteObject(currentPos, MORA_TICKS, midiPitch, lyric, prevRenderedMidi, portamentoLengthMs);
            notes.push(note);
            currentPos += MORA_TICKS;
            prevRenderedMidi = Math.round(midiPitch);
        });

        // Pause check
        const pauseSec = ap.pause_sec || 0;
        if ((pauseSec > 0.05 || ap.pause_mora) && apIdx < accentPhrases.length - 1) {
            const restMidi = chooseRestMidi(prevMoraAccented ? "high" : "low", prevSungMidi, nextVoicedMidi(fujisakiIdx), prevRenderedMidi);
            const restNote = createNoteObject(currentPos, MORA_TICKS, restMidi, "R", prevRenderedMidi, portamentoLengthMs);
            notes.push(restNote);
            currentPos += MORA_TICKS;
            prevRenderedMidi = Math.round(restMidi);
            pitchStats.rest++;
            pitchStats.phraseResets++;
        }
    });

    // 3. Sentence Ending R note
    if (notes.length > 0 && notes[notes.length - 1].lyric === "R") {
        // Do not duplicate R note
    } else {
        const endingMidi = chooseRestMidi("low", prevSungMidi, null, prevRenderedMidi);
        const endingRest = createNoteObject(currentPos, MORA_TICKS, endingMidi, "R", prevRenderedMidi, portamentoLengthMs);
        notes.push(endingRest);
        pitchStats.rest++;
    }

    return notes;
}

function isRestText(text) {
    return SOKUON_CHARS.has(text) || QUESTION_CHARS.has(text) || COMMA_CHARS.has(text) || PUNCTUATION_CHARS.has(text) || !text;
}

function hzToMidi(frequency) {
    return 69 + 12 * Math.log2(Math.max(1, frequency) / 440);
}

function chooseRestMidi(policy, previousMidi, nextMidi, fallbackMidi) {
    const anchors = [previousMidi, nextMidi].filter(Number.isFinite);
    const centre = anchors.length ? anchors.reduce((sum, value) => sum + value, 0) / anchors.length : fallbackMidi;
    const spanHigh = anchors.length ? Math.max(...anchors) : centre;
    const spanLow = anchors.length ? Math.min(...anchors) : centre;
    // High rests retain the former intent for sokuon/questions; low rests do
    // likewise for phrase boundaries and endings. The small offset preserves
    // that direction without breaking the surrounding melodic contour.
    if (policy === "high") return Math.max(centre + 0.35, spanHigh - 0.1);
    if (policy === "leading") return (nextMidi ?? fallbackMidi) - 0.6;
    return Math.min(centre - 0.35, spanLow + 0.1);
}

function createNoteObject(position, duration, midiPitch, lyric, previousMidi, portamentoLengthMs) {
    if (!lyric || lyric === '\ufffd') {
        lyric = "R";
    }

    const tone = Math.round(midiPitch);
    // The Fujisaki result is quantised to the nearest semitone for each note.
    // USTX pitch-point x coordinates are milliseconds. Pitch points retain
    // only the note-to-note portamento transition.
    const yTarget = 0;
    const yStart = previousMidi !== null ? (previousMidi - tone) * 10 : yTarget;
    return {
        position: position,
        duration: duration,
        tone: tone,
        lyric: lyric,
        pitch: {
            data: [
                {
                    x: -portamentoLengthMs,
                    y: yStart,
                    shape: "io"
                },
                {
                    x: portamentoLengthMs,
                    y: yTarget,
                    shape: "io"
                }
            ],
            snap_first: true
        },
        vibrato: {
            length: 0,
            period: 15,
            depth: 10,
            in: 10,
            out: 10,
            shift: 0,
            drift: 0,
            vol_link: 0
        },
        phoneme_expressions: [],
        phoneme_overrides: []
    };
}

/**
 * Pure JavaScript YAML dumper for USTX.
 */
function generateUstxYaml(obj) {
    if (typeof jsyaml !== 'undefined') {
        return jsyaml.dump(obj, { indent: 2, noArrayIndent: false, quotingType: '"' });
    }
    return dumpYamlRecursive(obj, 0);
}

function dumpYamlRecursive(data, indentLevel) {
    const indent = "  ".repeat(indentLevel);
    let out = "";

    if (Array.isArray(data)) {
        data.forEach(item => {
            if (typeof item === 'object' && item !== null) {
                const inner = dumpYamlRecursive(item, indentLevel + 1).trimStart();
                out += `${indent}- ${inner}`;
            } else {
                out += `${indent}- ${formatScalar(item)}\n`;
            }
        });
    } else if (typeof data === 'object' && data !== null) {
        const keys = Object.keys(data);
        keys.forEach((k, idx) => {
            const v = data[k];
            const prefix = (idx === 0 && indentLevel > 0) ? "" : indent;
            if (typeof v === 'object' && v !== null) {
                out += `${prefix}${k}:\n${dumpYamlRecursive(v, indentLevel + 1)}`;
            } else {
                out += `${prefix}${k}: ${formatScalar(v)}\n`;
            }
        });
    }
    return out;
}

function formatScalar(val) {
    if (typeof val === 'boolean') return val ? 'true' : 'false';
    if (val === null || val === undefined) return '""';
    if (typeof val === 'number') return String(val);
    const s = String(val);
    if (s.includes(":") || s.includes("#") || s.includes("[") || s === "" || !isNaN(s)) {
        return `"${s.replace(/"/g, '\\"')}"`;
    }
    return s;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        importCinkToProsodyProject,
        generateNoteSequence,
        exportNoteSequenceToUstx,
        resolveExportOptions,
        convertCinkToUstx,
        parseDialogueLines,
        quantizeFujisakiPitches
    };
}

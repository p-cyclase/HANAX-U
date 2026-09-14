/**
 * converter.js - HANAX-U コンバータ (COEIROINK .cink -> OpenUtau .ustx Engine)
 * Strictly matches official OpenUtau project file schema (v0.7).
 * Includes lyric sanitization to prevent OpenUTAU UNote.Validate IndexOutOfRangeException.
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
    norm: { name: "normalize", abbr: "norm", type: "Numerical", min: 0, max: 100, default_value: 86, is_flag: true, flag: "P" },
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
 * Main conversion function for JS environment.
 */
function convertCinkToUstx(cinkData, options = {}) {
    const portamentoLength = options.portamentoLength !== undefined ? options.portamentoLength : 80;
    const bpm = options.bpm !== undefined ? options.bpm : 180;
    const lines = parseDialogueLines(cinkData);

    if (!lines || lines.length === 0) {
        throw new Error("入力されたCOEIROINKデータ内に有効なセリフ（アクセント句）が見つかりませんでした。");
    }

    const tracks = [];
    const voiceParts = [];
    let totalNotesCount = 0;
    let pitchStats = { low: 0, mid: 0, high: 0, rest: 0 };

    lines.forEach((line, idx) => {
        const trackName = String(idx + 1).padStart(4, "0");
        const partName = line.text || `Line ${idx + 1}`;

        tracks.push({
            phonemizer: "OpenUtau.Core.DefaultPhonemizer",
            renderer_settings: {},
            track_name: trackName,
            track_color: "Blue",
            mute: false,
            solo: false,
            volume: 0,
            pan: 0,
            track_expressions: [],
            voice_color_names: [""]
        });

        const notes = buildNotesForDialogue(line, portamentoLength, pitchStats);
        totalNotesCount += notes.length;
        const partDuration = notes.length > 0 ? (notes[notes.length - 1].position + notes[notes.length - 1].duration) : 0;

        voiceParts.push({
            duration: partDuration,
            name: partName,
            comment: "",
            track_no: idx,
            position: 0,
            notes: notes,
            curves: []
        });
    });

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
        expressions: DEFAULT_EXPRESSIONS,
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

    return {
        ustxDict,
        ustxYaml,
        stats: {
            lineCount: lines.length,
            totalNotes: totalNotesCount,
            pitchStats: pitchStats,
            lines: lines
        }
    };
}

/**
 * Parses COEIROINK JSON into a standardized array of dialogue objects.
 */
function parseDialogueLines(data) {
    const lines = [];

    if (typeof data === 'object' && data !== null && !Array.isArray(data)) {
        if (Array.isArray(data.textBoxes)) {
            data.textBoxes.forEach((tb, idx) => {
                if (typeof tb === 'object' && tb !== null) {
                    const rawText = tb.text || tb.plain_text || `Line_${String(idx + 1).padStart(4, "0")}`;
                    const text = sanitizeText(rawText) || `Line_${String(idx + 1).padStart(4, "0")}`;
                    const speaker = sanitizeText(tb.speakerName || tb.speaker_name || "");
                    const prosody = tb.prosodyDetail || tb.accent_phrases || [];
                    const accentPhrases = normalizeAccentPhrases(prosody);

                    lines.push({
                        speaker_name: speaker,
                        text: text,
                        accent_phrases: accentPhrases,
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
                const speaker = sanitizeText(query.speakerName || "");
                lines.push({
                    speaker_name: speaker,
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
                        speaker_name: sanitizeText(val.speakerName || ""),
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
    const speaker = sanitizeText(item.speakerName || item.speaker_name || "");
    let accentPhrases = item.accent_phrases || item.prosodyDetail;
    if (!accentPhrases && item.audio_query) accentPhrases = item.audio_query.accent_phrases || item.audio_query.prosodyDetail;
    if (!accentPhrases && item.query) accentPhrases = item.query.accent_phrases || item.query.prosodyDetail;

    return {
        speaker_name: speaker,
        text: text,
        accent_phrases: normalizeAccentPhrases(accentPhrases)
    };
}

/**
 * Quantizes numeric pitches into 3 levels: Low (58), Mid (60), High (63).
 */
function quantizePitch3Stage(pitches) {
    const valid = pitches.filter(p => p !== null && p !== undefined && p > 0);
    if (valid.length === 0) return new Map();

    const sorted = [...valid].sort((a, b) => a - b);
    const n = sorted.length;
    const mapping = new Map();

    if (n === 1 || sorted[0] === sorted[n - 1]) {
        sorted.forEach(p => mapping.set(p, TONE_MID));
        return mapping;
    }

    let p33 = sorted[Math.floor(n / 3)];
    let p67 = sorted[Math.floor((2 * n) / 3)];

    if (p33 === p67) {
        const minP = sorted[0];
        const maxP = sorted[n - 1];
        p33 = minP + (maxP - minP) / 3.0;
        p67 = minP + (2.0 * (maxP - minP)) / 3.0;
    }

    const uniqueP = new Set(valid);
    uniqueP.forEach(p => {
        if (p < p33) {
            mapping.set(p, TONE_LOW);
        } else if (p < p67) {
            mapping.set(p, TONE_MID);
        } else {
            mapping.set(p, TONE_HIGH);
        }
    });

    return mapping;
}

/**
 * Builds array of notes for a dialogue line.
 */
function buildNotesForDialogue(line, portamentoLength, pitchStats) {
    const accentPhrases = line.accent_phrases || [];
    const allPitches = [];

    accentPhrases.forEach(ap => {
        (ap.moras || []).forEach(mora => {
            const text = mora.text || mora.hira || "";
            if (!SOKUON_CHARS.has(text) && !QUESTION_CHARS.has(text) && !COMMA_CHARS.has(text) && mora.pitch !== undefined && mora.pitch !== null && mora.pitch > 0) {
                allPitches.push(mora.pitch);
            }
        });
    });

    const hasNumericPitch = allPitches.length > 0;
    const pitchMap = hasNumericPitch ? quantizePitch3Stage(allPitches) : new Map();
    const notes = [];
    let currentPos = 0;

    // 1. Prepend Leading R Note (8th note = 240 ticks), Tone = Low (58)
    const leadingRest = createNoteObject(currentPos, MORA_TICKS, TONE_LOW, "R", null, portamentoLength);
    notes.push(leadingRest);
    currentPos += MORA_TICKS;
    let prevTone = TONE_LOW;
    let prevMoraAccented = false;
    pitchStats.rest++;

    accentPhrases.forEach((ap, apIdx) => {
        const moras = ap.moras || [];
        moras.forEach((mora, mIdx) => {
            const text = mora.text || mora.hira || "";
            const rawPitch = mora.pitch;
            const accent = mora.accent || 0;
            let lyric, tone;

            if (SOKUON_CHARS.has(text)) {
                lyric = "R";
                tone = TONE_HIGH;
                prevMoraAccented = true;
                pitchStats.rest++;
            } else if (QUESTION_CHARS.has(text)) {
                lyric = "R";
                tone = TONE_HIGH;
                prevMoraAccented = true;
                pitchStats.rest++;
            } else if (COMMA_CHARS.has(text)) {
                lyric = "R";
                tone = prevMoraAccented ? TONE_HIGH : TONE_LOW;
                prevMoraAccented = false;
                pitchStats.rest++;
            } else if (PUNCTUATION_CHARS.has(text) || !text) {
                lyric = "R";
                tone = TONE_LOW;
                prevMoraAccented = false;
                pitchStats.rest++;
            } else {
                lyric = text;
                if (hasNumericPitch && pitchMap.has(rawPitch)) {
                    tone = pitchMap.get(rawPitch);
                } else {
                    if (accent === 1) {
                        tone = TONE_HIGH;
                    } else if (mIdx === 0) {
                        tone = TONE_LOW;
                    } else {
                        tone = TONE_MID;
                    }
                }

                prevMoraAccented = (tone === TONE_HIGH || accent === 1);
                if (tone === TONE_LOW) pitchStats.low++;
                else if (tone === TONE_MID) pitchStats.mid++;
                else if (tone === TONE_HIGH) pitchStats.high++;
            }

            const note = createNoteObject(currentPos, MORA_TICKS, tone, lyric, prevTone, portamentoLength);
            notes.push(note);
            currentPos += MORA_TICKS;
            prevTone = tone;
        });

        // Pause check
        const pauseSec = ap.pause_sec || 0;
        if ((pauseSec > 0.05 || ap.pause_mora) && apIdx < accentPhrases.length - 1) {
            const restTone = prevMoraAccented ? TONE_HIGH : TONE_LOW;
            const restNote = createNoteObject(currentPos, MORA_TICKS, restTone, "R", prevTone, portamentoLength);
            notes.push(restNote);
            currentPos += MORA_TICKS;
            prevTone = restTone;
            pitchStats.rest++;
        }
    });

    // 3. Sentence Ending R note
    if (notes.length > 0 && notes[notes.length - 1].lyric === "R") {
        // Do not duplicate R note
    } else {
        const endingRest = createNoteObject(currentPos, MORA_TICKS, TONE_LOW, "R", prevTone, portamentoLength);
        notes.push(endingRest);
        pitchStats.rest++;
    }

    return notes;
}

function createNoteObject(position, duration, tone, lyric, prevTone, portamentoLength) {
    if (!lyric || lyric === '\ufffd') {
        lyric = "R";
    }

    const yStart = (prevTone !== null && prevTone !== tone) ? (prevTone - tone) * 10 : 0;
    return {
        position: position,
        duration: duration,
        tone: tone,
        lyric: lyric,
        pitch: {
            data: [
                {
                    x: -portamentoLength,
                    y: yStart,
                    shape: "io"
                },
                {
                    "x": portamentoLength,
                    "y": 0,
                    "shape": "io"
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
    module.exports = { convertCinkToUstx, parseDialogueLines, quantizePitch3Stage };
}

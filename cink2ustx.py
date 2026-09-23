#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cink2ustx.py - HANAX-U コンバータ (COEIROINK .cink -> OpenUtau .ustx)

Converts COEIROINK project files (.cink or JSON) to OpenUtau project format (.ustx).
Strictly matches official OpenUtau project file schema (v0.7).

Pitch Algorithm: Fujisaki Model (Command-Response Model)
- log F0(t) = log Fb + P(t) + A(t)
- Phrase component P(t) driven by phrase commands at sentence start & punctuation ("、")
- Accent component A(t) driven by accent==1 mora commands
- Range clamping and 3-stage MIDI note mapping (Low 58, Mid 60, High 63)
- Special corrections for sokuon, question marks, commas, track head & sentence end R notes
"""

import os
import sys
import json
import zipfile
import math
import argparse
from typing import List, Dict, Any, Tuple, Optional

# Timing Constants (quarter note = 480 ticks)
MORA_TICKS = 240  # 8th note

SOKUON_CHARS = {"っ", "ッ"}
QUESTION_CHARS = {"？", "?"}
COMMA_CHARS = {"、", ","}
PUNCTUATION_CHARS = {"。", ".", "！", "!"}

DEFAULT_EXPRESSIONS = {
    "dyn": {
        "name": "dynamics (curve)",
        "abbr": "dyn",
        "type": "Curve",
        "min": -240,
        "max": 120,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "pitd": {
        "name": "pitch deviation (curve)",
        "abbr": "pitd",
        "type": "Curve",
        "min": -1200,
        "max": 1200,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "clr": {
        "name": "voice color",
        "abbr": "clr",
        "type": "Options",
        "min": 0,
        "max": -1,
        "default_value": 0,
        "is_flag": False,
        "options": []
    },
    "eng": {
        "name": "resampler engine",
        "abbr": "eng",
        "type": "Options",
        "min": 0,
        "max": 1,
        "default_value": 0,
        "is_flag": False,
        "options": ["", "worldline"]
    },
    "vel": {
        "name": "velocity",
        "abbr": "vel",
        "type": "Numerical",
        "min": 0,
        "max": 200,
        "default_value": 100,
        "is_flag": False,
        "flag": ""
    },
    "vol": {
        "name": "volume",
        "abbr": "vol",
        "type": "Numerical",
        "min": 0,
        "max": 200,
        "default_value": 100,
        "is_flag": False,
        "flag": ""
    },
    "atk": {
        "name": "attack",
        "abbr": "atk",
        "type": "Numerical",
        "min": 0,
        "max": 200,
        "default_value": 100,
        "is_flag": False,
        "flag": ""
    },
    "dec": {
        "name": "decay",
        "abbr": "dec",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "gen": {
        "name": "gender",
        "abbr": "gen",
        "type": "Numerical",
        "min": -100,
        "max": 100,
        "default_value": 0,
        "is_flag": True,
        "flag": "g"
    },
    "genc": {
        "name": "gender (curve)",
        "abbr": "genc",
        "type": "Curve",
        "min": -100,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "bre": {
        "name": "breath",
        "abbr": "bre",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 0,
        "is_flag": True,
        "flag": "B"
    },
    "brec": {
        "name": "breathiness (curve)",
        "abbr": "brec",
        "type": "Curve",
        "min": -100,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "lpf": {
        "name": "lowpass",
        "abbr": "lpf",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 0,
        "is_flag": True,
        "flag": "H"
    },
    "norm": {
        "name": "normalize",
        "abbr": "norm",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 50,
        "is_flag": True,
        "flag": "P"
    },
    "mod": {
        "name": "modulation",
        "abbr": "mod",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "mod+": {
        "name": "modulation plus",
        "abbr": "mod+",
        "type": "Numerical",
        "min": 0,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "alt": {
        "name": "alternate",
        "abbr": "alt",
        "type": "Numerical",
        "min": 0,
        "max": 16,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "dir": {
        "name": "direct",
        "abbr": "dir",
        "type": "Options",
        "min": 0,
        "max": 1,
        "default_value": 0,
        "is_flag": False,
        "options": ["off", "on"]
    },
    "shft": {
        "name": "tone shift",
        "abbr": "shft",
        "type": "Numerical",
        "min": -36,
        "max": 36,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "shfc": {
        "name": "tone shift (curve)",
        "abbr": "shfc",
        "type": "Curve",
        "min": -1200,
        "max": 1200,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "tenc": {
        "name": "tension (curve)",
        "abbr": "tenc",
        "type": "Curve",
        "min": -100,
        "max": 100,
        "default_value": 0,
        "is_flag": False,
        "flag": ""
    },
    "voic": {
        "name": "voicing (curve)",
        "abbr": "voic",
        "type": "Curve",
        "min": 0,
        "max": 100,
        "default_value": 100,
        "is_flag": False,
        "flag": ""
    }
}

def extract_cink_json(file_path: str) -> Dict[str, Any]:
    """Extracts JSON data from a .cink file (raw JSON or zip file)."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Input file not found: {file_path}")
    
    if zipfile.is_zipfile(file_path):
        with zipfile.ZipFile(file_path, 'r') as zf:
            namelist = zf.namelist()
            json_file = None
            for candidate in ["project.json", "projects.json", "content.json"]:
                if candidate in namelist:
                    json_file = candidate
                    break
            if not json_file:
                for name in namelist:
                    if name.endswith('.json'):
                        json_file = name
                        break
            if not json_file:
                raise ValueError("No JSON file found inside .cink zip archive.")
            
            with zf.open(json_file) as f:
                content = f.read().decode('utf-8-sig', errors='replace')
                return json.loads(content)
    else:
        with open(file_path, 'r', encoding='utf-8-sig', errors='replace') as f:
            return json.load(f)

def sanitize_text(text: str) -> str:
    if not text:
        return ""
    return text.replace('\ufffd', '').strip()


def extract_speaker_identity(source: Dict[str, Any]) -> Dict[str, Any]:
    """Preserves source-speaker data for later OpenUtau singer mapping."""
    speaker_name = sanitize_text(str(source.get("speakerName") or source.get("speaker_name") or ""))
    style_name = sanitize_text(str(source.get("styleName") or source.get("style_name") or ""))
    speaker_uuid = sanitize_text(str(source.get("speakerUuid") or source.get("speaker_uuid") or ""))
    style_id = source.get("styleId", source.get("style_id"))
    if style_id == "":
        style_id = None
    return {
        "speaker_name": speaker_name,
        "speaker_uuid": speaker_uuid,
        "style_id": style_id,
        "style_name": style_name,
        "speaker_id": f"{speaker_uuid}:{style_id}" if speaker_uuid and style_id is not None else "",
    }

def parse_dialogue_lines(data: Any) -> List[Dict[str, Any]]:
    lines = []
    
    if isinstance(data, dict):
        if is_voicevox_project(data):
            return parse_voicevox_dialogue_lines(data)
        elif "textBoxes" in data and isinstance(data["textBoxes"], list):
            for idx, tb in enumerate(data["textBoxes"]):
                if not isinstance(tb, dict):
                    continue
                raw_text = tb.get("text") or tb.get("plain_text") or f"Line_{idx+1:04d}"
                text = sanitize_text(str(raw_text)) or f"Line_{idx+1:04d}"
                speaker_identity = extract_speaker_identity(tb)
                prosody = tb.get("prosodyDetail") or tb.get("accent_phrases") or []
                
                accent_phrases = []
                for phrase in prosody:
                    if isinstance(phrase, list):
                        moras = []
                        for m in phrase:
                            if isinstance(m, dict):
                                hira = sanitize_text(str(m.get("hira") or m.get("text") or m.get("phoneme") or ""))
                                pitch = m.get("pitch") or m.get("f0")
                                accent = m.get("accent", 0)
                                moras.append({
                                    "text": hira,
                                    "pitch": pitch,
                                    "accent": accent,
                                    "phoneme": m.get("phoneme", "")
                                })
                        if moras:
                            accent_phrases.append({"moras": moras})
                    elif isinstance(phrase, dict):
                        accent_phrases.append(phrase)
                
                lines.append({
                    **speaker_identity,
                    "text": text,
                    "accent_phrases": accent_phrases,
                    "pause_len": tb.get("pauseLength")
                })
        elif "audioQueryMap" in data:
            query_map = data.get("audioQueryMap", {})
            text_map = data.get("textMap", {})
            keys = data.get("audioKeys", list(query_map.keys()))
            for idx, key in enumerate(keys):
                query = query_map.get(key, {})
                text = sanitize_text(str(text_map.get(key, query.get("text", f"Line {idx+1}"))))
                lines.append({
                    **extract_speaker_identity(query),
                    "text": text,
                    "accent_phrases": normalize_accent_phrases(query.get("accent_phrases", []))
                })
        elif "accent_phrases" in data or "prosodyDetail" in data:
            lines.append(extract_dialogue_item(data, 0))
        elif "tracks" in data or "audio_items" in data or "block_list" in data or "speaker_blocks" in data:
            blocks = data.get("tracks") or data.get("audio_items") or data.get("block_list") or data.get("speaker_blocks") or []
            for idx, block in enumerate(blocks):
                lines.append(extract_dialogue_item(block, idx))
        else:
            for key, val in data.items():
                if isinstance(val, dict) and ("accent_phrases" in val or "prosodyDetail" in val):
                    text = sanitize_text(str(val.get("text", key)))
                    prosody = val.get("prosodyDetail") or val.get("accent_phrases")
                    lines.append({
                        **extract_speaker_identity(val),
                        "text": text,
                        "accent_phrases": normalize_accent_phrases(prosody)
                    })

    elif isinstance(data, list):
        for idx, item in enumerate(data):
            if isinstance(item, dict):
                lines.append(extract_dialogue_item(item, idx))
    
    return [l for l in lines if l and l.get("accent_phrases")]


def is_voicevox_project(data: Any) -> bool:
    talk = data.get("talk") if isinstance(data, dict) else None
    return isinstance(talk, dict) and isinstance(talk.get("audioKeys"), list) and isinstance(talk.get("audioItems"), dict)


def extract_voicevox_speaker_identity(voice: Any) -> Dict[str, Any]:
    voice = voice if isinstance(voice, dict) else {}
    speaker_id = sanitize_text(str(voice.get("speakerId") or ""))
    style_id = voice.get("styleId")
    if style_id == "":
        style_id = None
    return {
        "speaker_name": speaker_id,
        "speaker_uuid": speaker_id,
        "style_id": style_id,
        "style_name": "" if style_id is None else str(style_id),
        "speaker_id": f"{speaker_id}:{style_id}" if speaker_id and style_id is not None else "",
    }


def normalize_voicevox_accent_phrases(prosody: Any) -> List[Dict[str, Any]]:
    if not isinstance(prosody, list):
        return []
    result = []
    for phrase in prosody:
        if not isinstance(phrase, dict) or not isinstance(phrase.get("moras"), list):
            continue
        accent_position = phrase.get("accent") if isinstance(phrase.get("accent"), int) else 0
        moras = []
        for index, mora in enumerate(phrase["moras"]):
            text = voicevox_mora_to_hiragana(mora.get("text") or "") if isinstance(mora, dict) else ""
            if text:
                moras.append({"text": text, "accent": 1 if index + 1 == accent_position else 0, "phoneme": ""})
        if not moras:
            continue
        normalized = {"moras": moras}
        pause_mora = phrase.get("pauseMora")
        if isinstance(pause_mora, dict):
            normalized["pause_mora"] = True
            normalized["pause_sec"] = float(pause_mora.get("vowelLength") or 0)
        result.append(normalized)
    return result


def voicevox_mora_to_hiragana(text: Any) -> str:
    """Converts VOICEVOX katakana mora lyrics to UTAU-friendly hiragana.

    ヴ is retained so V-row aliases use forms such as ヴぁ, as requested.
    """
    result = []
    for char in sanitize_text(str(text)):
        code = ord(char)
        result.append(chr(code - 0x60) if 0x30A1 <= code <= 0x30F3 else char)
    return "".join(result)


def parse_voicevox_dialogue_lines(data: Dict[str, Any]) -> List[Dict[str, Any]]:
    talk = data["talk"]
    audio_items = talk["audioItems"]
    lines = []
    for index, key in enumerate(talk["audioKeys"]):
        item = audio_items.get(key)
        if not isinstance(item, dict):
            continue
        text = sanitize_text(str(item.get("text") or f"Line {index + 1}"))
        accent_phrases = normalize_voicevox_accent_phrases(item.get("query", {}).get("accentPhrases"))
        lines.append({
            **extract_voicevox_speaker_identity(item.get("voice")),
            "text": text,
            "accent_phrases": accent_phrases or make_accent_phrases_from_text(text),
        })
    return lines


def make_accent_phrases_from_text(text: str) -> List[Dict[str, Any]]:
    """Fallback for a VOICEVOX item whose saved query has no usable moras."""
    moras = [{"text": char, "accent": 0, "phoneme": ""} for char in text if not char.isspace()]
    return [{"moras": moras}] if moras else []

def normalize_accent_phrases(prosody: Any) -> List[Dict[str, Any]]:
    if not isinstance(prosody, list):
        return []
    result = []
    for phrase in prosody:
        if isinstance(phrase, list):
            moras = []
            for m in phrase:
                if isinstance(m, dict):
                    hira = sanitize_text(str(m.get("hira") or m.get("text") or m.get("phoneme") or ""))
                    moras.append({
                        "text": hira,
                        "pitch": m.get("pitch") or m.get("f0"),
                        "accent": m.get("accent", 0),
                        "phoneme": m.get("phoneme", "")
                    })
            if moras:
                result.append({"moras": moras})
        elif isinstance(phrase, dict):
            result.append(phrase)
    return result

def extract_dialogue_item(item: Dict[str, Any], idx: int) -> Dict[str, Any]:
    text = sanitize_text(str(item.get("text") or item.get("plain_text") or item.get("title") or f"Line_{idx+1:04d}"))
    accent_phrases = item.get("accent_phrases") or item.get("prosodyDetail")
    if accent_phrases is None and "audio_query" in item:
        accent_phrases = item.get("audio_query", {}).get("accent_phrases") or item.get("audio_query", {}).get("prosodyDetail")
    if accent_phrases is None and "query" in item:
        accent_phrases = item.get("query", {}).get("accent_phrases") or item.get("query", {}).get("prosodyDetail")
    
    return {
        **extract_speaker_identity(item),
        "text": text,
        "accent_phrases": normalize_accent_phrases(accent_phrases)
    }

# ==============================================================================
# Fujisaki Model F0 & Pitch Calculation Engine
# ==============================================================================

def fujisaki_phrase_response(t: float, alpha: float = 3.0) -> float:
    """Impulse response of Fujisaki phrase control mechanism: G_p(t) = alpha^2 * t * exp(-alpha * t)."""
    if t < 0:
        return 0.0
    return (alpha ** 2) * t * math.exp(-alpha * t)

def fujisaki_accent_response(t: float, beta: float = 20.0, gamma: float = 0.9) -> float:
    """Step response of Fujisaki accent control mechanism: G_a(t) = min(1 - (1 + beta*t)*exp(-beta*t), gamma)."""
    if t < 0:
        return 0.0
    val = 1.0 - (1.0 + beta * t) * math.exp(-beta * t)
    return min(val, gamma)

def compute_fujisaki_pitches_for_line(line: Dict[str, Any], bpm: int = 180,
                                     alpha: float = 3.0, beta: float = 20.0,
                                     fb_hz: float = 150.0, phrase_magnitude: float = 0.35,
                                     accent_magnitude: float = 0.45) -> List[Tuple[Dict[str, Any], float]]:
    """
    Computes Fujisaki model fundamental frequency F0(t) for each mora in a dialogue line.
    - Phrase commands are triggered at sentence start and after punctuation ("、") or phrase pauses.
    - Accent commands are active during moras with accent == 1.
    - Returns list of (mora_dict, f0_hz) tuples.
    """
    accent_phrases = line.get("accent_phrases", [])
    mora_duration_sec = (60.0 / float(bpm)) * 0.5  # 8th note duration in seconds
    
    # Flatten moras with timing
    timeline_moras = []
    current_time = 0.0
    
    phrase_command_times = [0.0]  # Sentence start phrase command
    
    for ap_idx, ap in enumerate(accent_phrases):
        moras = ap.get("moras", [])
        for m_idx, mora in enumerate(moras):
            text = mora.get("text") or mora.get("hira") or ""
            timeline_moras.append({
                "mora": mora,
                "start_time": current_time,
                "text": text,
                "accent": mora.get("accent", 0)
            })
            current_time += mora_duration_sec
            
            # Phrase reset on comma
            if text in COMMA_CHARS or text in PUNCTUATION_CHARS:
                phrase_command_times.append(current_time)
        
        # Phrase reset on pause_sec between accent phrases
        pause_sec = ap.get("pause_sec", 0.0)
        pause_mora = ap.get("pause_mora")
        if (pause_sec > 0.05 or pause_mora is not None) and ap_idx < len(accent_phrases) - 1:
            phrase_command_times.append(current_time)
    
    log_fb = math.log(fb_hz)
    ap_mag = max(0.0, phrase_magnitude)
    aa_mag = max(0.0, accent_magnitude)
    
    results = []
    for item in timeline_moras:
        t = item["start_time"] + (mora_duration_sec / 2.0)  # Midpoint time of mora
        
        # 1. Sum Phrase Component P(t)
        p_t = 0.0
        for t_p in phrase_command_times:
            if t >= t_p:
                p_t += ap_mag * fujisaki_phrase_response(t - t_p, alpha=alpha)
        
        # 2. Sum Accent Component A(t)
        a_t = 0.0
        for other in timeline_moras:
            if other["accent"] == 1:
                t1 = other["start_time"]
                t2 = t1 + mora_duration_sec
                if t >= t1:
                    a_t += aa_mag * (fujisaki_accent_response(t - t1, beta=beta) - fujisaki_accent_response(t - t2, beta=beta))
        
        log_f0 = log_fb + p_t + a_t
        f0_hz = math.exp(log_f0)
        results.append((item["mora"], f0_hz))
        
    return results

# ==============================================================================
# Note Generation with Fujisaki Pitch Model & Special Rest Corrections
# ==============================================================================

def is_rest_text(text: str) -> bool:
    return text in SOKUON_CHARS or text in QUESTION_CHARS or text in COMMA_CHARS or text in PUNCTUATION_CHARS or not text


def hz_to_midi(frequency: float) -> float:
    return 69 + 12 * math.log2(max(1.0, frequency) / 440.0)

def build_notes_for_dialogue(line: Dict[str, Any], portamento_length: int = 60,
                             bpm: int = 180, alpha: float = 3.0, beta: float = 20.0,
                             fb_hz: float = 150.0, phrase_magnitude: float = 0.35,
                             accent_magnitude: float = 0.45) -> List[Dict[str, Any]]:
    """Builds semitone-quantized notes and explicit paired R rests at boundaries."""
    accent_phrases = line.get("accent_phrases", [])
    fujisaki_results = compute_fujisaki_pitches_for_line(
        line, bpm=bpm, alpha=alpha, beta=beta, fb_hz=fb_hz,
        phrase_magnitude=phrase_magnitude, accent_magnitude=accent_magnitude)
    f0_values = [f0 for (_, f0) in fujisaki_results]
    mora_events = [mora for phrase in accent_phrases for mora in phrase.get("moras", [])]

    def fallback_tone(index: int) -> int:
        f0 = f0_values[index] if index < len(f0_values) else fb_hz
        return round(hz_to_midi(f0))

    def next_voiced_tone(start_index: int) -> Optional[int]:
        for index in range(start_index, len(mora_events)):
            text = mora_events[index].get("text") or mora_events[index].get("hira") or ""
            if not is_rest_text(text):
                return fallback_tone(index)
        return None

    notes: List[Dict[str, Any]] = []
    current_pos = 0
    prev_tone: Optional[int] = None
    prev_sung_tone: Optional[int] = None
    prev_mora_accented = False

    def append_rest(tone: int) -> None:
        nonlocal current_pos, prev_tone
        note = create_note_object(current_pos, MORA_TICKS, tone, "R", prev_tone, portamento_length)
        notes.append(note)
        current_pos += MORA_TICKS
        prev_tone = note["tone"]

    def previous_rest_tone(delta: int, fallback: int) -> int:
        return (prev_sung_tone if prev_sung_tone is not None else fallback) + delta

    # Track-leading R and every post-boundary leading R sit three semitones below the next voice.
    append_rest((next_voiced_tone(0) if next_voiced_tone(0) is not None else fallback_tone(0)) - 3)

    fujisaki_idx = 0
    for ap_idx, ap in enumerate(accent_phrases):
        phrase_ends_with_boundary = False
        for mora in ap.get("moras", []):
            text = mora.get("text") or mora.get("hira") or ""
            accent = mora.get("accent", 0)
            fallback = fallback_tone(fujisaki_idx)
            fujisaki_idx += 1
            next_tone = next_voiced_tone(fujisaki_idx)

            if text in SOKUON_CHARS:
                append_rest(previous_rest_tone(3 if prev_mora_accented else -3, fallback))
                phrase_ends_with_boundary = False
            elif text in QUESTION_CHARS or text in COMMA_CHARS or text in PUNCTUATION_CHARS or not text:
                tail_delta = 5 if text in QUESTION_CHARS else (3 if prev_mora_accented else -3)
                append_rest(previous_rest_tone(tail_delta, fallback))
                if next_tone is not None:
                    append_rest(next_tone - 3)
                prev_mora_accented = False
                phrase_ends_with_boundary = True
            else:
                note = create_note_object(current_pos, MORA_TICKS, fallback, text, prev_tone, portamento_length)
                notes.append(note)
                current_pos += MORA_TICKS
                prev_tone = note["tone"]
                prev_sung_tone = note["tone"]
                prev_mora_accented = accent == 1
                phrase_ends_with_boundary = False

        pause_sec = ap.get("pause_sec", 0.0)
        if not phrase_ends_with_boundary and (pause_sec > 0.05 or ap.get("pause_mora") is not None) and ap_idx < len(accent_phrases) - 1:
            fallback = fallback_tone(fujisaki_idx)
            append_rest(previous_rest_tone(3 if prev_mora_accented else -3, fallback))
            next_tone = next_voiced_tone(fujisaki_idx)
            if next_tone is not None:
                append_rest(next_tone - 3)
            prev_mora_accented = False

    if notes and notes[-1]["lyric"] != "R":
        append_rest(previous_rest_tone(-3, prev_tone if prev_tone is not None else fallback_tone(fujisaki_idx)))
    return notes

def create_note_object(position: int, duration: int, tone: int, lyric: str, 
                       prev_tone: Optional[int], portamento_length: int = 60) -> Dict[str, Any]:
    """Creates an OpenUtau note dictionary matching official schema."""
    if not lyric or lyric == '\ufffd':
        lyric = "R"
        
    if prev_tone is not None and prev_tone != tone:
        y_start = (prev_tone - tone) * 10
    else:
        y_start = 0

    return {
        "position": position,
        "duration": duration,
        "tone": tone,
        "lyric": lyric,
        "pitch": {
            "data": [
                {
                    "x": -portamento_length,
                    "y": y_start,
                    "shape": "io"
                },
                {
                    "x": portamento_length,
                    "y": 0,
                    "shape": "io"
                }
            ],
            "snap_first": True
        },
        "vibrato": {
            "length": 0,
            "period": 15,
            "depth": 10,
            "in": 10,
            "out": 10,
            "shift": 0,
            "drift": 0,
            "vol_link": 0
        },
        "phoneme_expressions": [],
        "phoneme_overrides": []
    }

def import_cink_to_prosody_project(cink_data: Any) -> Dict[str, Any]:
    """Stage 1: imports COEIROINK or VOICEVOX Talk data into format-neutral prosody data."""
    lines = parse_dialogue_lines(cink_data)
    if not lines:
        raise ValueError("入力されたプロジェクト内に有効なセリフ（アクセント句）が見つかりませんでした。")
    return {"source_format": "voicevox" if is_voicevox_project(cink_data) else "coeiroink", "lines": lines}


def generate_note_sequence(prosody_project: Dict[str, Any], portamento_length: int = 60,
                           bpm: int = 180, alpha: float = 3.0, beta: float = 20.0,
                           fb_hz: float = 150.0, phrase_magnitude: float = 0.35,
                           accent_magnitude: float = 0.45) -> Dict[str, Any]:
    """Stage 2: generates format-neutral notes from prosody data."""
    parts = []
    for idx, line in enumerate(prosody_project["lines"]):
        notes = build_notes_for_dialogue(line, portamento_length=portamento_length, bpm=bpm,
                                         alpha=alpha, beta=beta, fb_hz=fb_hz,
                                         phrase_magnitude=phrase_magnitude, accent_magnitude=accent_magnitude)
        parts.append({
            "name": line.get("text", f"Line {idx+1}"),
            "duration": notes[-1]["position"] + notes[-1]["duration"] if notes else 0,
            "notes": notes,
        })
    return {
        "source_format": prosody_project["source_format"],
        "lines": prosody_project["lines"],
        "parts": parts,
        "options": {"bpm": bpm, "portamento_length": portamento_length, "alpha": alpha,
                    "beta": beta, "fb_hz": fb_hz, "phrase_magnitude": phrase_magnitude,
                    "accent_magnitude": accent_magnitude},
    }


SUPPORTED_PHONEMIZERS = {
    "OpenUtau.Core.DefaultPhonemizer",
    "OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer",
}
SUPPORTED_RENDERERS = {"CLASSIC", "WORLDLINE-R"}
TRACK_NAME_FORMATS = {"number", "number-text", "number-singer-text"}


def filename_fragment(value: Any, max_length: int) -> str:
    """Creates a short filename-safe suffix shared by USTX tracks and TXT files."""
    text = sanitize_text(str(value))
    text = "".join("_" if char in '<>:"/\\|?*' or ord(char) < 32 else char for char in text)
    text = " ".join(text.split()).rstrip(". ")
    return text[:max_length]


def create_track_name(index: int, line: Dict[str, Any], singer: str, track_name_format: str) -> str:
    ordinal = f"{index + 1:03d}"
    if track_name_format == "number":
        return ordinal
    text = filename_fragment(line.get("text", ""), 24)
    if track_name_format == "number-text":
        return f"{ordinal}_{text}" if text else ordinal
    singer_or_speaker = filename_fragment(singer or line.get("speaker_name") or line.get("speaker_uuid") or "speaker", 8)
    return f"{ordinal}_{singer_or_speaker}_{text}" if text else f"{ordinal}_{singer_or_speaker}"


def export_note_sequence_to_ustx(note_sequence: Dict[str, Any],
                                 singer_mappings: Optional[Dict[str, Dict[str, Any]]] = None,
                                 track_name_format: str = "number") -> Dict[str, Any]:
    """Stage 3: exports a note sequence as an OpenUtau .ustx dictionary."""
    bpm = note_sequence["options"]["bpm"]
    lines = note_sequence["lines"]
    singer_mappings = singer_mappings or {}
    track_name_format = track_name_format if track_name_format in TRACK_NAME_FORMATS else "number"
    tracks = []
    voice_parts = []
    
    for idx, line in enumerate(lines):
        part_name = line.get("text", f"Line {idx+1}")
        
        mapping = singer_mappings.get(line.get("speaker_id", ""), {})
        singer = str(mapping.get("singer", "")).strip() if isinstance(mapping, dict) else ""
        track_name = create_track_name(idx, line, singer, track_name_format)
        phonemizer = mapping.get("phonemizer") if isinstance(mapping, dict) else None
        renderer = mapping.get("renderer") if isinstance(mapping, dict) else None
        track = {
            "phonemizer": phonemizer if singer and phonemizer in SUPPORTED_PHONEMIZERS
            else "OpenUtau.Core.DefaultPhonemizer",
            "renderer_settings": {"renderer": renderer}
            if singer and renderer in SUPPORTED_RENDERERS else ({"renderer": "CLASSIC"} if singer else {}),
            "track_name": track_name,
            "track_color": "Blue",
            "mute": False,
            "solo": False,
            "volume": 0,
            "pan": 0,
            "track_expressions": [],
        }
        if singer:
            track["singer"] = singer
        tracks.append(track)
        
        note_part = note_sequence["parts"][idx]
        
        voice_parts.append({
            "duration": note_part["duration"],
            "name": note_part["name"],
            "comment": "",
            "track_no": idx,
            "position": 0,
            "notes": note_part["notes"],
            "curves": []
        })
    
    ustx = {
        "name": "HANAX-U Export",
        "comment": "",
        "output_dir": "Vocal",
        "cache_dir": "UCache",
        "ustx_version": "0.7",
        "resolution": 480,
        "bpm": bpm,
        "beat_per_bar": 4,
        "beat_unit": 4,
        "expressions": DEFAULT_EXPRESSIONS,
        "exp_selectors": [
            "dyn", "pitd", "clr", "eng", "vel", "vol", "atk", "dec", "gen", "bre"
        ],
        "exp_primary": 0,
        "exp_secondary": 1,
        "key": 0,
        "time_signatures": [
            {
                "bar_position": 0,
                "beat_per_bar": 4,
                "beat_unit": 4
            }
        ],
        "tempos": [
            {
                "position": 0,
                "bpm": bpm
            }
        ],
        "tracks": tracks,
        "voice_parts": voice_parts,
        "wave_parts": []
    }
    
    return ustx


def convert_cink_to_ustx(cink_data: Any, portamento_length: int = 60, bpm: int = 180,
                         alpha: float = 3.0, beta: float = 20.0, fb_hz: float = 150.0,
                         singer_mappings: Optional[Dict[str, Dict[str, Any]]] = None,
                         track_name_format: str = "number", phrase_magnitude: float = 0.35,
                         accent_magnitude: float = 0.45) -> Dict[str, Any]:
    """Backward-compatible entry point composed from the three conversion stages."""
    prosody_project = import_cink_to_prosody_project(cink_data)
    note_sequence = generate_note_sequence(prosody_project, portamento_length, bpm, alpha, beta, fb_hz,
                                           phrase_magnitude, accent_magnitude)
    return export_note_sequence_to_ustx(note_sequence, singer_mappings, track_name_format)

def save_ustx_file(ustx_dict: Dict[str, Any], output_path: str):
    try:
        import yaml
        yaml_content = yaml.dump(ustx_dict, allow_unicode=True, sort_keys=False, default_flow_style=False)
    except ImportError:
        yaml_content = dump_yaml_fallback(ustx_dict)
    
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(yaml_content)

def dump_yaml_fallback(data: Any, indent_level: int = 0) -> str:
    indent = "  " * indent_level
    lines = []
    
    if isinstance(data, dict):
        for k, v in data.items():
            if isinstance(v, (dict, list)):
                lines.append(f"{indent}{k}:")
                lines.append(dump_yaml_fallback(v, indent_level + 1))
            else:
                lines.append(f"{indent}{k}: {format_yaml_scalar(v)}")
    elif isinstance(data, list):
        for item in data:
            if isinstance(item, dict):
                item_lines = dump_yaml_fallback(item, indent_level + 1).lstrip()
                lines.append(f"{indent}- {item_lines}")
            else:
                lines.append(f"{indent}- {format_yaml_scalar(item)}")
    return "\n".join(lines)

def format_yaml_scalar(val: Any) -> str:
    if isinstance(val, bool):
        return "true" if val else "false"
    if val is None:
        return '""'
    if isinstance(val, (int, float)):
        return str(val)
    s = str(val)
    if ":" in s or "#" in s or "[" in s or "]" in s or "{" in s or "}" in s or s == "" or s.isdigit():
        return f'"{s}"'
    return s

def main():
    parser = argparse.ArgumentParser(description="HANAX-U コンバータ (藤崎モデル搭載 COEIROINK .cink / JSON -> OpenUtau .ustx)")
    parser.add_argument("input_path", help="Path to input .cink or .json file")
    parser.add_argument("output_path", nargs="?", help="Path to output .ustx file (optional)")
    parser.add_argument("--bpm", type=int, default=180, help="Tempo BPM (default: 180)")
    parser.add_argument("--portamento", type=int, default=60, help="Portamento transition length in milliseconds (default: 60)")
    parser.add_argument("--alpha", type=float, default=3.0, help="Fujisaki alpha phrase decay parameter (default: 3.0)")
    parser.add_argument("--beta", type=float, default=20.0, help="Fujisaki beta accent rise parameter (default: 20.0)")
    parser.add_argument("--phrase-magnitude", type=float, default=0.35, help="Fujisaki phrase component magnitude (default: 0.35)")
    parser.add_argument("--accent-magnitude", type=float, default=0.45, help="Fujisaki accent component magnitude (default: 0.45)")
    parser.add_argument("--fb", type=float, default=150.0, help="Fujisaki base frequency Fb in Hz (default: 150.0)")
    
    args = parser.parse_args()
    
    input_path = args.input_path
    if not args.output_path:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".ustx"
    else:
        output_path = args.output_path
        
    print(f"Reading COEIROINK project from: {input_path}")
    cink_data = extract_cink_json(input_path)
    
    print("Converting to OpenUtau format using Fujisaki Model Pitch Engine...")
    ustx_data = convert_cink_to_ustx(cink_data, portamento_length=args.portamento, bpm=args.bpm,
                                     alpha=args.alpha, beta=args.beta, fb_hz=args.fb,
                                     phrase_magnitude=args.phrase_magnitude,
                                     accent_magnitude=args.accent_magnitude)
    
    save_ustx_file(ustx_data, output_path)
    print(f"Successfully exported OpenUtau project to: {output_path}")
    print(f"Total Tracks / Lines: {len(ustx_data['tracks'])}")

if __name__ == "__main__":
    main()

#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
cink2ustx.py - HANAX-U コンバータ (COEIROINK .cink -> OpenUtau .ustx)

Converts COEIROINK project files (.cink or JSON) to OpenUtau project format (.ustx).
Strictly matches official OpenUtau project file schema (v0.7).
Includes lyric sanitization to prevent OpenUTAU UNote.Validate IndexOutOfRangeException.
"""

import os
import sys
import json
import zipfile
import argparse
from typing import List, Dict, Any, Tuple, Optional

# Pitch Mapping Constants
TONE_LOW = 58   # A#3
TONE_MID = 60   # C4
TONE_HIGH = 63  # D#4
REST_TONE = 60  # Fallback tone for rests

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
        "default_value": 86,
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
    # Remove unicode replacement character \ufffd
    cleaned = text.replace('\ufffd', '').strip()
    return cleaned

def parse_dialogue_lines(data: Any) -> List[Dict[str, Any]]:
    lines = []
    
    if isinstance(data, dict):
        if "textBoxes" in data and isinstance(data["textBoxes"], list):
            for idx, tb in enumerate(data["textBoxes"]):
                if not isinstance(tb, dict):
                    continue
                raw_text = tb.get("text") or tb.get("plain_text") or f"Line_{idx+1:04d}"
                text = sanitize_text(str(raw_text)) or f"Line_{idx+1:04d}"
                speaker_name = sanitize_text(str(tb.get("speakerName") or tb.get("speaker_name") or ""))
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
                    "speaker_name": speaker_name,
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
                speaker = sanitize_text(str(query.get("speakerName", "")))
                lines.append({
                    "speaker_name": speaker,
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
                    speaker = sanitize_text(str(val.get("speakerName", "")))
                    prosody = val.get("prosodyDetail") or val.get("accent_phrases")
                    lines.append({
                        "speaker_name": speaker,
                        "text": text,
                        "accent_phrases": normalize_accent_phrases(prosody)
                    })

    elif isinstance(data, list):
        for idx, item in enumerate(data):
            if isinstance(item, dict):
                lines.append(extract_dialogue_item(item, idx))
    
    return [l for l in lines if l and l.get("accent_phrases")]

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
    speaker = sanitize_text(str(item.get("speakerName") or item.get("speaker_name") or ""))
    accent_phrases = item.get("accent_phrases") or item.get("prosodyDetail")
    if accent_phrases is None and "audio_query" in item:
        accent_phrases = item.get("audio_query", {}).get("accent_phrases") or item.get("audio_query", {}).get("prosodyDetail")
    if accent_phrases is None and "query" in item:
        accent_phrases = item.get("query", {}).get("accent_phrases") or item.get("query", {}).get("prosodyDetail")
    
    return {
        "speaker_name": speaker,
        "text": text,
        "accent_phrases": normalize_accent_phrases(accent_phrases)
    }

def quantize_pitch_3stage(pitches: List[float]) -> Dict[float, int]:
    valid_pitches = [p for p in pitches if p is not None and p > 0]
    if not valid_pitches:
        return {}
    
    sorted_p = sorted(valid_pitches)
    n = len(sorted_p)
    if n == 1 or sorted_p[0] == sorted_p[-1]:
        return {p: TONE_MID for p in set(valid_pitches)}
    
    p33 = sorted_p[n // 3]
    p67 = sorted_p[(2 * n) // 3]
    
    if p33 == p67:
        min_p = sorted_p[0]
        max_p = sorted_p[-1]
        p33 = min_p + (max_p - min_p) / 3.0
        p67 = min_p + 2.0 * (max_p - min_p) / 3.0
    
    mapping = {}
    for p in set(valid_pitches):
        if p < p33:
            mapping[p] = TONE_LOW
        elif p < p67:
            mapping[p] = TONE_MID
        else:
            mapping[p] = TONE_HIGH
            
    return mapping

def build_notes_for_dialogue(line: Dict[str, Any], portamento_length: int = 80) -> List[Dict[str, Any]]:
    accent_phrases = line.get("accent_phrases", [])
    
    all_pitches = []
    for ap in accent_phrases:
        for mora in ap.get("moras", []):
            text = mora.get("text") or mora.get("hira") or ""
            pitch = mora.get("pitch")
            if text not in SOKUON_CHARS and text not in QUESTION_CHARS and text not in COMMA_CHARS and pitch is not None and pitch > 0:
                all_pitches.append(pitch)
    
    has_numeric_pitch = len(all_pitches) > 0
    pitch_map = quantize_pitch_3stage(all_pitches) if has_numeric_pitch else {}
    
    notes = []
    current_pos = 0
    
    # Prepend Leading R note
    leading_rest = create_note_object(
        position=current_pos,
        duration=MORA_TICKS,
        tone=TONE_LOW,
        lyric="R",
        prev_tone=None,
        portamento_length=portamento_length
    )
    notes.append(leading_rest)
    current_pos += MORA_TICKS
    prev_tone: Optional[int] = TONE_LOW
    prev_mora_accented = False
    
    for ap_idx, ap in enumerate(accent_phrases):
        moras = ap.get("moras", [])
        for m_idx, mora in enumerate(moras):
            text = mora.get("text") or mora.get("hira") or ""
            raw_pitch = mora.get("pitch")
            accent = mora.get("accent", 0)
            
            if text in SOKUON_CHARS:
                lyric = "R"
                tone = TONE_HIGH
                prev_mora_accented = True
            elif text in QUESTION_CHARS:
                lyric = "R"
                tone = TONE_HIGH
                prev_mora_accented = True
            elif text in COMMA_CHARS:
                lyric = "R"
                tone = TONE_HIGH if prev_mora_accented else TONE_LOW
                prev_mora_accented = False
            elif text in PUNCTUATION_CHARS or not text or text == '\ufffd':
                lyric = "R"
                tone = TONE_LOW
                prev_mora_accented = False
            else:
                lyric = text
                if has_numeric_pitch and raw_pitch in pitch_map:
                    tone = pitch_map[raw_pitch]
                else:
                    if accent == 1:
                        tone = TONE_HIGH
                    elif m_idx == 0:
                        tone = TONE_LOW
                    else:
                        tone = TONE_MID
                prev_mora_accented = (tone == TONE_HIGH or accent == 1)
            
            note = create_note_object(
                position=current_pos,
                duration=MORA_TICKS,
                tone=tone,
                lyric=lyric,
                prev_tone=prev_tone,
                portamento_length=portamento_length
            )
            notes.append(note)
            current_pos += MORA_TICKS
            prev_tone = tone
        
        # Pause between accent phrases
        pause_sec = ap.get("pause_sec", 0.0)
        pause_mora = ap.get("pause_mora")
        if (pause_sec > 0.05 or pause_mora is not None) and ap_idx < len(accent_phrases) - 1:
            rest_tone = TONE_HIGH if prev_mora_accented else TONE_LOW
            rest_note = create_note_object(
                position=current_pos,
                duration=MORA_TICKS,
                tone=rest_tone,
                lyric="R",
                prev_tone=prev_tone,
                portamento_length=portamento_length
            )
            notes.append(rest_note)
            current_pos += MORA_TICKS
            prev_tone = rest_tone

    # Sentence ending R rest note:
    if notes and notes[-1]["lyric"] == "R":
        pass
    else:
        ending_rest = create_note_object(
            position=current_pos,
            duration=MORA_TICKS,
            tone=TONE_LOW,
            lyric="R",
            prev_tone=prev_tone,
            portamento_length=portamento_length
        )
        notes.append(ending_rest)
    
    return notes

def create_note_object(position: int, duration: int, tone: int, lyric: str, 
                       prev_tone: Optional[int], portamento_length: int = 80) -> Dict[str, Any]:
    """Creates an OpenUtau note dictionary with sanitized lyric."""
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

def convert_cink_to_ustx(cink_data: Any, portamento_length: int = 80, bpm: int = 180) -> Dict[str, Any]:
    lines = parse_dialogue_lines(cink_data)
    if not lines:
        raise ValueError("入力されたCOEIROINKデータ内に有効なセリフ（アクセント句）が見つかりませんでした。")
    
    tracks = []
    voice_parts = []
    
    for idx, line in enumerate(lines):
        track_name = f"{idx + 1:04d}"
        part_name = line.get("text", f"Line {idx+1}")
        
        tracks.append({
            "phonemizer": "OpenUtau.Core.DefaultPhonemizer",
            "renderer_settings": {},
            "track_name": track_name,
            "track_color": "Blue",
            "mute": False,
            "solo": False,
            "volume": 0,
            "pan": 0,
            "track_expressions": [],
            "voice_color_names": [""]
        })
        
        notes = build_notes_for_dialogue(line, portamento_length=portamento_length)
        part_duration = notes[-1]["position"] + notes[-1]["duration"] if notes else 0
        
        voice_parts.append({
            "duration": part_duration,
            "name": part_name,
            "comment": "",
            "track_no": idx,
            "position": 0,
            "notes": notes,
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
    parser = argparse.ArgumentParser(description="HANAX-U コンバータ (COEIROINK .cink / JSON -> OpenUtau .ustx)")
    parser.add_argument("input_path", help="Path to input .cink or .json file")
    parser.add_argument("output_path", nargs="?", help="Path to output .ustx file (optional)")
    parser.add_argument("--bpm", type=int, default=180, help="Tempo BPM (default: 180)")
    parser.add_argument("--portamento", type=int, default=80, help="Portamento transition length in ticks (default: 80)")
    
    args = parser.parse_args()
    
    input_path = args.input_path
    if not args.output_path:
        base, _ = os.path.splitext(input_path)
        output_path = base + ".ustx"
    else:
        output_path = args.output_path
        
    print(f"Reading COEIROINK project from: {input_path}")
    cink_data = extract_cink_json(input_path)
    
    print("Converting to OpenUtau format...")
    ustx_data = convert_cink_to_ustx(cink_data, portamento_length=args.portamento, bpm=args.bpm)
    
    save_ustx_file(ustx_data, output_path)
    print(f"Successfully exported OpenUtau project to: {output_path}")
    print(f"Total Tracks / Lines: {len(ustx_data['tracks'])}")

if __name__ == "__main__":
    main()

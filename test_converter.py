#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_converter.py - Automated unit tests for HANAX-U Converter
"""

import os
import json
import unittest
import yaml
from cink2ustx import convert_cink_to_ustx, save_ustx_file, TONE_LOW, TONE_MID, TONE_HIGH, REST_TONE, MORA_TICKS

class TestHanaxUConverter(unittest.TestCase):

    def setUp(self):
        self.native_cink_data = {
            "projectFileVersion": "v2",
            "textBoxes": [
                {
                    "textBoxUuid": "tb-001",
                    "speakerName": "つくよみちゃん",
                    "text": "やあやあ、はじめまして？",
                    "prosodyDetail": [
                        [
                            {"phoneme": "y-a", "hira": "や", "accent": 1},
                            {"phoneme": "a", "hira": "あ", "accent": 0}
                        ],
                        [
                            {"phoneme": "y-a", "hira": "や", "accent": 0},
                            {"phoneme": "a", "hira": "あ", "accent": 0}
                        ],
                        [
                            {"phoneme": "t-o", "hira": "、", "accent": 0}
                        ],
                        [
                            {"phoneme": "h-a", "hira": "は", "accent": 0},
                            {"phoneme": "z-i", "hira": "じ", "accent": 1},
                            {"phoneme": "m-e", "hira": "め", "accent": 0},
                            {"phoneme": "m-a", "hira": "ま", "accent": 0},
                            {"phoneme": "s-i", "hira": "し", "accent": 0},
                            {"phoneme": "t-e", "hira": "て", "accent": 0},
                            {"phoneme": "q", "hira": "？", "accent": 0}
                        ]
                    ]
                }
            ]
        }

    def test_hanax_u_specs(self):
        ustx = convert_cink_to_ustx(self.native_cink_data, portamento_length=80, bpm=180)
        
        # 1. Project BPM & Naming
        self.assertEqual(ustx["bpm"], 180)
        self.assertEqual(ustx["name"], "HANAX-U Export")
        
        # 2. Track & Part
        self.assertEqual(len(ustx["tracks"]), 1)
        self.assertEqual(ustx["tracks"][0]["track_name"], "0001")
        self.assertEqual(ustx["voice_parts"][0]["name"], "やあやあ、はじめまして？")
        
        notes = ustx["voice_parts"][0]["notes"]
        lyrics = [n["lyric"] for n in notes]
        tones = [n["tone"] for n in notes]
        
        # 3. Leading R Note
        self.assertEqual(lyrics[0], "R")
        self.assertEqual(tones[0], TONE_LOW)  # Tone Low (58)
        self.assertEqual(notes[0]["position"], 0)
        
        # 4. Question mark "？" -> R (Tone High 63) and no duplicate ending R
        self.assertEqual(lyrics[-1], "R")
        self.assertEqual(tones[-1], TONE_HIGH)  # Question mark R is High (63)
        self.assertNotEqual(lyrics[-2], "R")    # Last mora "て" before question mark
        
        # 5. Vibrato settings check
        expected_vibrato = {"length": 0, "period": 15, "depth": 10, "in": 10, "out": 10, "shift": 0, "drift": 0, "vol_link": 0}
        for n in notes:
            self.assertEqual(n["vibrato"], expected_vibrato)
            # 6. Portamento check on ALL notes including R
            self.assertEqual(len(n["pitch"]["data"]), 2)
            self.assertEqual(n["pitch"]["data"][0]["x"], -80)
            self.assertEqual(n["pitch"]["data"][1]["x"], 80)

    def test_sokuon_and_comma_tones(self):
        sokuon_data = {
            "projectFileVersion": "v2",
            "textBoxes": [
                {
                    "speakerName": "つくよみちゃん",
                    "text": "やっぱり、すごいっ！",
                    "prosodyDetail": [
                        [
                            {"hira": "ヤ", "accent": 0},
                            {"hira": "ッ", "accent": 0},
                            {"hira": "パ", "accent": 1},
                            {"hira": "リ", "accent": 0},
                            {"hira": "、", "accent": 0}
                        ],
                        [
                            {"hira": "ス", "accent": 0},
                            {"hira": "ゴ", "accent": 1},
                            {"hira": "イ", "accent": 0},
                            {"hira": "っ", "accent": 0}
                        ]
                    ]
                }
            ]
        }
        ustx = convert_cink_to_ustx(sokuon_data)
        notes = ustx["voice_parts"][0]["notes"]
        
        # Note 0: Leading R (Low 58)
        # Note 1: "ヤ" (Low 58)
        # Note 2: "ッ" -> R (High 63)
        # Note 3: "パ" (High 63 - accent 1)
        # Note 4: "リ" (Low 58)
        # Note 5: "、" -> R (Low 58 since preceding "リ" not accented)
        self.assertEqual(notes[2]["lyric"], "R")
        self.assertEqual(notes[2]["tone"], TONE_HIGH)
        
        # Last note: "っ" -> R (High 63), and duplicate ending R is omitted
        self.assertEqual(notes[-1]["lyric"], "R")
        self.assertEqual(notes[-1]["tone"], TONE_HIGH)

    def test_yaml_export(self):
        ustx = convert_cink_to_ustx(self.native_cink_data)
        test_file = "test_hanax_u.ustx"
        try:
            save_ustx_file(ustx, test_file)
            self.assertTrue(os.path.exists(test_file))
            
            with open(test_file, 'r', encoding='utf-8') as f:
                parsed = yaml.safe_load(f)
            self.assertEqual(parsed["ustx_version"], "0.7")
            self.assertEqual(parsed["bpm"], 180)
            self.assertEqual(len(parsed["tracks"]), 1)
        finally:
            if os.path.exists(test_file):
                os.remove(test_file)

if __name__ == "__main__":
    unittest.main()

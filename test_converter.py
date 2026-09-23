#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_converter.py - Automated unit tests for HANAX-U Converter with Fujisaki Pitch Model
"""

import os
import json
import unittest
import yaml
from cink2ustx import convert_cink_to_ustx, save_ustx_file, parse_dialogue_lines, compute_fujisaki_pitches_for_line, TONE_LOW, TONE_MID, TONE_HIGH, MORA_TICKS

class TestFujisakiConverter(unittest.TestCase):

    def setUp(self):
        self.native_cink_data = {
            "projectFileVersion": "v2",
            "textBoxes": [
                {
                    "textBoxUuid": "tb-001",
                    "speakerName": "テスト話者",
                    "text": "やあやあきみたち、はじめまして？",
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

    def test_fujisaki_pitch_contour(self):
        lines = parse_dialogue_lines(self.native_cink_data)
        self.assertEqual(len(lines), 1)
        
        fujisaki_results = compute_fujisaki_pitches_for_line(lines[0], bpm=180, alpha=3.0, beta=20.0, fb_hz=130.0)
        
        # Verify F0 Hz calculated for each mora
        self.assertTrue(len(fujisaki_results) > 0)
        for mora, f0 in fujisaki_results:
            self.assertGreater(f0, 100.0)  # Should be above base pitch 130 Hz
            self.assertLess(f0, 500.0)

    def test_hanax_u_fujisaki_specs(self):
        ustx = convert_cink_to_ustx(self.native_cink_data, portamento_length=80, bpm=180, alpha=3.0, beta=20.0, fb_hz=130.0)
        
        self.assertEqual(ustx["bpm"], 180)
        self.assertEqual(ustx["name"], "HANAX-U Export")
        self.assertEqual(len(ustx["tracks"]), 1)
        self.assertEqual(ustx["tracks"][0]["track_name"], "0001")
        self.assertEqual(ustx["voice_parts"][0]["name"], "やあやあきみたち、はじめまして？")
        
        notes = ustx["voice_parts"][0]["notes"]
        lyrics = [n["lyric"] for n in notes]
        tones = [n["tone"] for n in notes]
        
        # Leading R note
        self.assertEqual(lyrics[0], "R")
        self.assertEqual(tones[0], TONE_LOW)
        
        # Question mark R note at end is Tone High (63)
        self.assertEqual(lyrics[-1], "R")
        self.assertEqual(tones[-1], TONE_HIGH)
        
        # Vibrato settings
        expected_vibrato = {"length": 0, "period": 15, "depth": 10, "in": 10, "out": 10, "shift": 0, "drift": 0, "vol_link": 0}
        for n in notes:
            self.assertEqual(n["vibrato"], expected_vibrato)

    def test_yaml_export(self):
        ustx = convert_cink_to_ustx(self.native_cink_data)
        test_file = "test_fujisaki.ustx"
        try:
            save_ustx_file(ustx, test_file)
            self.assertTrue(os.path.exists(test_file))
            
            with open(test_file, 'r', encoding='utf-8') as f:
                parsed = yaml.safe_load(f)
            self.assertEqual(parsed["ustx_version"], "0.7")
            self.assertEqual(parsed["bpm"], 180)
        finally:
            if os.path.exists(test_file):
                os.remove(test_file)

if __name__ == "__main__":
    unittest.main()

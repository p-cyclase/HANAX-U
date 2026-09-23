/**
 * app.js - Web UI Controller for HANAX-U Converter (Fujisaki Model)
 */

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const applySettingsBtn = document.getElementById('applySettingsBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const downloadZipBtn = document.getElementById('downloadZipBtn');
    const bpmInput = document.getElementById('bpmInput');
    const portamentoInput = document.getElementById('portamentoInput');
    const alphaInput = document.getElementById('alphaInput');
    const betaInput = document.getElementById('betaInput');
    const phraseMagnitudeInput = document.getElementById('phraseMagnitudeInput');
    const accentMagnitudeInput = document.getElementById('accentMagnitudeInput');
    const fbInput = document.getElementById('fbInput');
    const genInput = document.getElementById('genInput');
    const breInput = document.getElementById('breInput');
    const lpfInput = document.getElementById('lpfInput');
    const normalizeInput = document.getElementById('normalizeInput');
    const modInput = document.getElementById('modInput');
    const trackNameFormatInput = document.getElementById('trackNameFormatInput');
    const singerMappingsContainer = document.getElementById('singerMappings');

    const previewSection = document.getElementById('previewSection');
    const statLines = document.getElementById('statLines');
    const statNotes = document.getElementById('statNotes');
    const statF0Range = document.getElementById('statF0Range');
    const statPitches = document.getElementById('statPitches');
    const tracksContainer = document.getElementById('tracksContainer');

    let currentFile = null;
    let convertedResult = null;
    let importedProsodyProject = null;
    let generatedNoteSequence = null;
    const singerMappings = new Map();

    // File Drop Events
    dropzone.addEventListener('click', () => fileInput.click());
    
    dropzone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropzone.classList.add('drag-over');
    });

    dropzone.addEventListener('dragleave', () => {
        dropzone.classList.remove('drag-over');
    });

    dropzone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropzone.classList.remove('drag-over');
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            handleFileSelect(e.dataTransfer.files[0]);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    });

    function handleFileSelect(file) {
        currentFile = file;
        importedProsodyProject = null;
        generatedNoteSequence = null;
        convertedResult = null;
        downloadBtn.disabled = true;
        downloadZipBtn.disabled = true;
        const dropzoneTitle = dropzone.querySelector('h3');
        const dropzoneSub = dropzone.querySelector('p');
        
        dropzoneTitle.textContent = `選択中: ${file.name}`;
        dropzoneSub.textContent = `サイズ: ${(file.size / 1024).toFixed(1)} KB`;
        applySettingsBtn.hidden = false;
        
        processFile(file);
    }

    applySettingsBtn.addEventListener('click', () => {
        if (importedProsodyProject) regenerateFromSettings();
    });

    async function processFile(file) {
        try {
            const rawData = await readCinkFile(file);
            importedProsodyProject = importCinkToProsodyProject(rawData);
            regenerateFromSettings();
        } catch (err) {
            alert(`エラーが発生しました:\n${err.message}`);
            console.error(err);
        }
    }

    function regenerateFromSettings() {
        try {
            generatedNoteSequence = generateNoteSequence(importedProsodyProject, {
                portamentoLengthMs: parseInt(portamentoInput.value, 10) || 60,
                bpm: parseInt(bpmInput.value, 10) || 200,
                alpha: parseFloat(alphaInput.value) || 3.0,
                beta: parseFloat(betaInput.value) || 20.0,
                phraseMagnitude: Number.isFinite(parseFloat(phraseMagnitudeInput.value)) ? parseFloat(phraseMagnitudeInput.value) : 0.35,
                accentMagnitude: Number.isFinite(parseFloat(accentMagnitudeInput.value)) ? parseFloat(accentMagnitudeInput.value) : 0.45,
                fbHz: parseFloat(fbInput.value) || 150.0
            });
            refreshExportResult();
        } catch (err) {
            alert(`エラーが発生しました:\n${err.message}`);
            console.error(err);
        }
    }

    function refreshExportResult() {
        updateExportResult();
        renderPreview(convertedResult);
        renderSingerMappings(convertedResult.stats.lines);
        downloadBtn.disabled = false;
        downloadZipBtn.disabled = false;
    }

    // Generator の結果は保持したまま、現在の出力設定で USTX を組み立てる。
    // ダウンロード時にも呼び出し、出力設定だけの変更を即座に反映する。
    function updateExportResult() {
        const expressionValues = {
            gen: parseInt(genInput.value, 10),
            bre: parseInt(breInput.value, 10),
            lpf: parseInt(lpfInput.value, 10),
            norm: parseInt(normalizeInput.value, 10),
            mod: parseInt(modInput.value, 10)
        };
        convertedResult = {
            ...exportNoteSequenceToUstx(generatedNoteSequence, {
                expressionValues,
                trackNameFormat: trackNameFormatInput.value,
                singerMappings: Object.fromEntries(singerMappings)
            }),
            stats: generatedNoteSequence.stats
        };
    }

    async function readCinkFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        
        if (typeof JSZip !== 'undefined') {
            try {
                const zip = await JSZip.loadAsync(arrayBuffer);
                let jsonFile = zip.file("project.json") || zip.file("projects.json") || zip.file("content.json");
                if (!jsonFile) {
                    const jsonFiles = Object.keys(zip.files).filter(name => name.endsWith('.json'));
                    if (jsonFiles.length > 0) {
                        jsonFile = zip.file(jsonFiles[0]);
                    }
                }
                if (jsonFile) {
                    const text = await jsonFile.async("text");
                    return JSON.parse(text);
                }
            } catch (e) {
                // Not a zip file, fallback
            }
        }

        const textDecoder = new TextDecoder('utf-8');
        return parseCinkText(textDecoder.decode(arrayBuffer));
    }

    /**
     * COEIROINK project files can be plain JSON, but older/exported projects
     * may use an INI-like format beginning with [project].
     */
    function parseCinkText(source) {
        const text = source.replace(/^\uFEFF/, '').trim();
        if (!text) throw new Error('ファイルの内容が空です。');

        try {
            return JSON.parse(text);
        } catch (jsonError) {
            if (!/^\s*\[project\]/im.test(text)) {
                throw new Error('JSONとして読み込めませんでした。COEIROINKの .cink ファイルを選択してください。');
            }
        }

        const project = parseIniCink(text);
        if (project.textBoxes.length === 0) {
            throw new Error('COEIROINKプロジェクト内にセリフが見つかりませんでした。');
        }
        return project;
    }

    function parseIniCink(text) {
        const project = { projectFileVersion: 'ini', textBoxes: [] };
        let sectionName = '';
        let fields = {};

        const saveSection = () => {
            if (!/^(textbox|text_box|line|audio)/i.test(sectionName) || !fields.text) return;
            const textBox = { ...fields };
            ['prosodyDetail', 'accent_phrases', 'audio_query', 'query'].forEach(key => {
                if (typeof textBox[key] !== 'string') return;
                try { textBox[key] = JSON.parse(textBox[key]); } catch (_) { /* Keep plain values as-is. */ }
            });
            project.textBoxes.push(textBox);
        };

        text.split(/\r?\n/).forEach(rawLine => {
            const line = rawLine.trim();
            if (!line || line.startsWith(';') || line.startsWith('#')) return;
            const header = line.match(/^\[([^\]]+)\]$/);
            if (header) {
                saveSection();
                sectionName = header[1].trim();
                fields = {};
                return;
            }
            const match = line.match(/^([^=:#]+)\s*[=:]\s*(.*)$/);
            if (!match) return;
            const key = match[1].trim();
            let value = match[2].trim();
            if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
                value = value.slice(1, -1);
            }
            fields[key] = value;
        });
        saveSection();
        return project;
    }

    function renderPreview(result) {
        const { ustxDict, stats } = result;

        statLines.textContent = stats.lineCount;
        statNotes.textContent = stats.totalNotes;
        const minF = stats.pitchStats.f0Min < 999 ? stats.pitchStats.f0Min : 150;
        const maxF = stats.pitchStats.f0Max > 0 ? stats.pitchStats.f0Max : 150;
        statF0Range.textContent = `${minF} - ${maxF} Hz`;
        statPitches.textContent = `${stats.pitchStats.semitone} notes`;

        tracksContainer.innerHTML = '';

        ustxDict.tracks.forEach((track, idx) => {
            const part = ustxDict.voice_parts[idx];
            const lineInfo = stats.lines[idx] || {};
            const speakerLabel = formatSpeakerLabel(lineInfo);
            const dialogueText = part.name;

            let formattedHeader = "";
            if (speakerLabel) {
                formattedHeader = `${speakerLabel}「${dialogueText}」`;
            } else {
                formattedHeader = `「${dialogueText}」`;
            }

            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';

            const meta = document.createElement('div');
            meta.className = 'track-meta';
            meta.innerHTML = `
                <span class="track-dialogue-text">${escapeHtml(formattedHeader)}</span>
            `;

            const timeline = document.createElement('div');
            timeline.className = 'notes-timeline';

            part.notes.forEach(note => {
                const chip = document.createElement('div');
                let toneClass = 'tone-rest';
                let pitchLabel = 'R';

                if (note.lyric !== 'R') {
                    toneClass = 'tone-note';
                    pitchLabel = midiToNoteName(note.tone);
                    // With the default Fb (150 Hz), Fujisaki-generated notes
                    // usually cluster around MIDI 50–63 (D3–D#4). Map that
                    // practical range across the full cool-to-warm palette.
                    const normalizedTone = Math.max(0, Math.min(1, (note.tone - 50) / 13));
                    chip.style.setProperty('--note-hue', String(220 - normalizedTone * 220));
                } else {
                    pitchLabel = midiToNoteName(note.tone);
                }

                chip.className = `note-chip ${toneClass}`;
                chip.innerHTML = `
                    <span class="note-lyric">${escapeHtml(note.lyric)}</span>
                    <span class="note-pitch-tag">${pitchLabel}</span>
                `;
                timeline.appendChild(chip);
            });

            trackItem.appendChild(meta);
            trackItem.appendChild(timeline);
            tracksContainer.appendChild(trackItem);
        });

        previewSection.style.display = 'flex';
    }

    function renderSingerMappings(lines) {
        const speakers = new Map();
        lines.forEach(line => {
            if (line.speaker_id && !speakers.has(line.speaker_id)) {
                speakers.set(line.speaker_id, line);
            }
        });
        singerMappingsContainer.innerHTML = '';

        if (speakers.size === 0) {
            const message = document.createElement('p');
            message.className = 'mapping-empty';
            message.textContent = 'マッピング可能な話者情報はありません。';
            singerMappingsContainer.appendChild(message);
            return;
        }

        speakers.forEach((speaker, speakerId) => {
            const mapping = singerMappings.get(speakerId) || {};
            const item = document.createElement('div');
            item.className = 'singer-mapping-item';

            const speakerLabel = document.createElement('div');
            speakerLabel.className = 'mapping-speaker';
            speakerLabel.textContent = formatSpeakerLabel(speaker);

            const singerInput = document.createElement('input');
            singerInput.type = 'text';
            singerInput.placeholder = 'singer名（任意）';
            singerInput.value = mapping.singer || '';
            singerInput.setAttribute('aria-label', `${formatSpeakerLabel(speaker)} の singer名`);

            const phonemizerSelect = createMappingSelect([
                { value: 'OpenUtau.Core.DefaultPhonemizer', label: 'DEFAULT' },
                { value: 'OpenUtau.Plugin.Builtin.JapanesePresampPhonemizer', label: 'JA VCV & CVVC' }
            ], mapping.phonemizer || 'OpenUtau.Core.DefaultPhonemizer', 'phonemizer');
            const rendererSelect = createMappingSelect(['CLASSIC', 'WORLDLINE-R'], mapping.renderer || 'CLASSIC', 'renderer');

            const updateMapping = () => {
                const singer = singerInput.value.trim();
                if (singer) {
                    singerMappings.set(speakerId, {
                        singer,
                        phonemizer: phonemizerSelect.value,
                        renderer: rendererSelect.value
                    });
                } else {
                    singerMappings.delete(speakerId);
                }
            };
            singerInput.addEventListener('input', updateMapping);
            [singerInput, phonemizerSelect, rendererSelect].forEach(control => control.addEventListener('change', updateMapping));

            item.append(speakerLabel, singerInput, phonemizerSelect, rendererSelect);
            singerMappingsContainer.appendChild(item);
        });
    }

    function createMappingSelect(values, selectedValue, label) {
        const select = document.createElement('select');
        select.setAttribute('aria-label', label);
        values.forEach(entry => {
            const value = typeof entry === 'string' ? entry : entry.value;
            const displayLabel = typeof entry === 'string' ? entry : entry.label;
            const option = document.createElement('option');
            option.value = value;
            option.textContent = displayLabel;
            option.selected = value === selectedValue;
            select.appendChild(option);
        });
        return select;
    }

    downloadBtn.addEventListener('click', () => {
        if (!generatedNoteSequence || !currentFile) return;
        updateExportResult();

        const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
        const outputFileName = `${baseName}.ustx`;
        const blob = new Blob([convertedResult.ustxYaml], { type: 'text/yaml;charset=utf-8;' });

        triggerDownload(blob, outputFileName);
    });

    downloadZipBtn.addEventListener('click', async () => {
        if (!generatedNoteSequence || !currentFile) return;
        if (typeof JSZip === 'undefined') {
            alert('ZIP出力用のライブラリを読み込めませんでした。通信状態を確認してから再試行してください。');
            return;
        }
        updateExportResult();

        const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
        const zip = new JSZip();
        zip.file(`${baseName}.ustx`, convertedResult.ustxYaml);

        convertedResult.ustxDict.voice_parts.forEach((part, index) => {
            const track = convertedResult.ustxDict.tracks[index];
            const trackName = track.track_name;
            zip.file(`Export/${baseName}_${trackName}.txt`, part.name);
        });
        zip.file(`Log/${baseName}_conversion.log`, buildConversionLog(baseName));

        downloadZipBtn.disabled = true;
        try {
            const blob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(blob, `${baseName}.zip`);
        } finally {
            downloadZipBtn.disabled = false;
        }
    });

    function triggerDownload(blob, outputFileName) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }

    function buildConversionLog(baseName) {
        const { stats, ustxDict } = convertedResult;
        const trackNameFormatLabels = {
            number: '連番のみ',
            'number-text': '連番_セリフ',
            'number-singer-text': '連番_singer_セリフ'
        };
        const settings = {
            bpm: bpmInput.value,
            portamentoLengthMs: portamentoInput.value,
            alpha: alphaInput.value,
            beta: betaInput.value,
            phraseMagnitude: phraseMagnitudeInput.value,
            accentMagnitude: accentMagnitudeInput.value,
            fbHz: fbInput.value,
            gen: genInput.value,
            bre: breInput.value,
            lpf: lpfInput.value,
            norm: normalizeInput.value,
            mod: modInput.value
        };
        const lines = [
            'HANAX-U Conversion Log',
            `Generated (UTC): ${new Date().toISOString()}`,
            '',
            '[Source]',
            `file: ${currentFile.name}`,
            `format: ${stats.sourceFormat || 'unknown'}`,
            '',
            '[Conversion settings]',
            ...Object.entries(settings).map(([key, value]) => `${key}: ${value}`),
            '',
            '[Output settings]',
            `track_name_format: ${trackNameFormatLabels[trackNameFormatInput.value] || trackNameFormatInput.value}`,
            `ustx: ${baseName}.ustx`,
            `text_directory: Export/`,
            `log_file: Log/${baseName}_conversion.log`,
            '',
            '[Result]',
            `tracks: ${ustxDict.tracks.length}`,
            `notes: ${stats.totalNotes}`,
            '',
            '[Tracks]'
        ];

        ustxDict.tracks.forEach((track, index) => {
            const part = ustxDict.voice_parts[index];
            lines.push(`- ${track.track_name}`);
            lines.push(`  singer: ${track.singer || '(not set)'}`);
            lines.push(`  text_file: Export/${baseName}_${track.track_name}.txt`);
            lines.push(`  text: ${part.name}`);
        });
        return `${lines.join('\n')}\n`;
    }

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function midiToNoteName(midi) {
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    }

    function formatSpeakerLabel(line) {
        const speakerName = line.speaker_name || "";
        const styleName = line.style_name || "";
        if (!speakerName) return "";
        return styleName ? `${speakerName}（${styleName}）` : speakerName;
    }
});

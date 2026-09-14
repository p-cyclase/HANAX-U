/**
 * app.js - Web UI Controller for HANAX-U Converter (Fujisaki Model)
 */

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const convertBtn = document.getElementById('convertBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const bpmInput = document.getElementById('bpmInput');
    const portamentoInput = document.getElementById('portamentoInput');
    const alphaInput = document.getElementById('alphaInput');
    const betaInput = document.getElementById('betaInput');
    const fbInput = document.getElementById('fbInput');

    const previewSection = document.getElementById('previewSection');
    const statLines = document.getElementById('statLines');
    const statNotes = document.getElementById('statNotes');
    const statF0Range = document.getElementById('statF0Range');
    const statPitches = document.getElementById('statPitches');
    const tracksContainer = document.getElementById('tracksContainer');

    let currentFile = null;
    let convertedResult = null;

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
        const dropzoneTitle = dropzone.querySelector('h3');
        const dropzoneSub = dropzone.querySelector('p');
        
        dropzoneTitle.textContent = `選択中: ${file.name}`;
        dropzoneSub.textContent = `サイズ: ${(file.size / 1024).toFixed(1)} KB`;
        
        convertBtn.disabled = false;
        processFile(file);
    }

    convertBtn.addEventListener('click', () => {
        if (currentFile) {
            processFile(currentFile);
        }
    });

    async function processFile(file) {
        try {
            const rawData = await readCinkFile(file);
            const portamentoLengthMs = parseInt(portamentoInput.value, 10) || 60;
            const bpm = parseInt(bpmInput.value, 10) || 200;
            const alpha = parseFloat(alphaInput.value) || 3.0;
            const beta = parseFloat(betaInput.value) || 20.0;
            const fbHz = parseFloat(fbInput.value) || 150.0;

            convertedResult = convertCinkToUstx(rawData, { portamentoLengthMs, bpm, alpha, beta, fbHz });
            renderPreview(convertedResult);

            downloadBtn.disabled = false;
        } catch (err) {
            alert(`エラーが発生しました:\n${err.message}`);
            console.error(err);
        }
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
            const speakerName = lineInfo.speaker_name || "";
            const dialogueText = part.name;

            let formattedHeader = "";
            if (speakerName) {
                formattedHeader = `${speakerName}「${dialogueText}」`;
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
                } else {
                    pitchLabel = 'R';
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

    downloadBtn.addEventListener('click', () => {
        if (!convertedResult || !currentFile) return;

        const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
        const outputFileName = `${baseName}.ustx`;
        const blob = new Blob([convertedResult.ustxYaml], { type: 'text/yaml;charset=utf-8;' });

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = outputFileName;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });

    function escapeHtml(str) {
        return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function midiToNoteName(midi) {
        const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
        return `${names[((midi % 12) + 12) % 12]}${Math.floor(midi / 12) - 1}`;
    }
});

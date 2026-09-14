/**
 * app.js - Web UI Controller for HANAX-U Converter
 */

document.addEventListener('DOMContentLoaded', () => {
    const dropzone = document.getElementById('dropzone');
    const fileInput = document.getElementById('fileInput');
    const convertBtn = document.getElementById('convertBtn');
    const downloadBtn = document.getElementById('downloadBtn');
    const bpmInput = document.getElementById('bpmInput');
    const portamentoInput = document.getElementById('portamentoInput');

    const previewSection = document.getElementById('previewSection');
    const statLines = document.getElementById('statLines');
    const statNotes = document.getElementById('statNotes');
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
            const portamentoLength = parseInt(portamentoInput.value, 10) || 80;
            const bpm = parseInt(bpmInput.value, 10) || 180;

            convertedResult = convertCinkToUstx(rawData, { portamentoLength, bpm });
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
        const jsonText = textDecoder.decode(arrayBuffer);
        return JSON.parse(jsonText);
    }

    function renderPreview(result) {
        const { ustxDict, stats } = result;

        statLines.textContent = stats.lineCount;
        statNotes.textContent = stats.totalNotes;
        statPitches.textContent = `L:${stats.pitchStats.low} | M:${stats.pitchStats.mid} | H:${stats.pitchStats.high}`;

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
                    if (note.tone === 58) { toneClass = 'tone-58'; pitchLabel = 'A#3'; }
                    else if (note.tone === 60) { toneClass = 'tone-60'; pitchLabel = 'C4'; }
                    else if (note.tone === 63) { toneClass = 'tone-63'; pitchLabel = 'D#4'; }
                } else {
                    if (note.tone === 58) { pitchLabel = 'R (低)'; }
                    else if (note.tone === 63) { pitchLabel = 'R (高)'; }
                    else { pitchLabel = 'R'; }
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
});

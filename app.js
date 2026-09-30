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
    const trackNameFormatInputs = document.querySelectorAll('input[name="trackNameFormat"]');
    const zipContentInput = document.getElementById('zipContentInput');
    const singerMappingsContainer = document.getElementById('singerMappings');
    const fileError = document.getElementById('fileError');
    const processingStatus = document.getElementById('processingStatus');
    const processingMessage = document.getElementById('processingMessage');
    const resyncModeNotice = document.getElementById('resyncModeNotice');
    const conversionSettings = document.querySelector('.options-bar');
    const expressionSettings = document.querySelector('.expression-settings');
    const singerMappingSection = document.querySelector('.singer-mapping-section');

    const outputSection = document.getElementById('outputSection');
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
    let resyncProject = null;
    let appMode = 'convert';
    let importRequestId = 0;
    const singerMappings = new Map();

    const MAX_INPUT_FILE_SIZE = 20 * 1024 * 1024;
    const MAX_ARCHIVE_UNCOMPRESSED_SIZE = 50 * 1024 * 1024;
    const SUPPORTED_FILE_EXTENSIONS = new Set(['.cink', '.vvproj', '.ustx']);
    const PROCESSING_STATUS_MIN_DURATION_MS = 250;
    const SPEAKER_HUES = [190, 152, 45, 330, 262, 28, 170, 350];
    const STYLE_VARIANTS = [
        { saturation: 82, lightness: 74 },
        { saturation: 66, lightness: 80 },
        { saturation: 95, lightness: 68 },
        { saturation: 50, lightness: 84 }
    ];
    const LAB_TIME_UNITS_PER_SECOND = 10_000_000;
    const USTX_TICKS_PER_QUARTER = 480;

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
        const validationError = validateInputFile(file);
        if (validationError) {
            showFileError(validationError);
            fileInput.value = '';
            return;
        }

        clearFileError();
        downloadBtn.disabled = true;
        downloadZipBtn.disabled = true;
        const requestId = ++importRequestId;
        const processingStartedAt = showProcessingStatus('ファイルを読み込んでいます…');
        if (getFileExtension(file.name) === '.ustx') {
            processUstxFile(file, requestId, processingStartedAt);
        } else {
            processFile(file, requestId, processingStartedAt);
        }
    }

    function setSelectedFile(file) {
        exitResyncMode();
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
    }

    function enterResyncMode() {
        appMode = 'resync';
        conversionSettings.classList.add('mode-disabled');
        expressionSettings.classList.add('mode-disabled');
        singerMappingSection.classList.add('mode-disabled');
        applySettingsBtn.hidden = true;
        downloadBtn.hidden = true;
        downloadZipBtn.querySelector('span').textContent = '🗜 再同期ZIPをダウンロード';
        previewSection.style.display = 'none';
        resyncModeNotice.textContent = 'USTX再同期モードです。トラック名を現在のファイル名形式で付け直し、アイテム名からTXTを出力します。LABは「.labも出力する」がオンの場合のみ作成します。';
        resyncModeNotice.hidden = false;
    }

    function exitResyncMode() {
        appMode = 'convert';
        resyncProject = null;
        conversionSettings.classList.remove('mode-disabled');
        expressionSettings.classList.remove('mode-disabled');
        singerMappingSection.classList.remove('mode-disabled');
        downloadBtn.hidden = false;
        downloadZipBtn.querySelector('span').textContent = '🗜 セリフ付きZIPをダウンロード';
        resyncModeNotice.hidden = true;
    }

    applySettingsBtn.addEventListener('click', async () => {
        if (!importedProsodyProject) return;
        applySettingsBtn.disabled = true;
        const processingStartedAt = showProcessingStatus('設定を反映しています…');
        await regenerateFromSettings(processingStartedAt);
        applySettingsBtn.disabled = false;
    });

    async function processFile(file, requestId, processingStartedAt) {
        try {
            const rawData = await readCinkFile(file);
            const prosodyProject = importCinkToProsodyProject(rawData);
            if (requestId !== importRequestId) return;
            setSelectedFile(file);
            importedProsodyProject = prosodyProject;
            await regenerateFromSettings(processingStartedAt);
        } catch (err) {
            if (requestId !== importRequestId) return;
            hideProcessingStatus();
            showFileError(`読み込めませんでした。${err.message}`);
            if (generatedNoteSequence && currentFile) {
                downloadBtn.disabled = false;
                downloadZipBtn.disabled = false;
            }
            console.error(err);
        }
    }

    async function processUstxFile(file, requestId, processingStartedAt) {
        try {
            const project = await readUstxProject(file);
            if (requestId !== importRequestId) return;
            currentFile = file;
            importedProsodyProject = null;
            generatedNoteSequence = null;
            convertedResult = null;
            resyncProject = project;
            const dropzoneTitle = dropzone.querySelector('h3');
            const dropzoneSub = dropzone.querySelector('p');
            dropzoneTitle.textContent = `選択中: ${file.name}`;
            dropzoneSub.textContent = `サイズ: ${(file.size / 1024).toFixed(1)} KB`;
            enterResyncMode();
            outputSection.style.display = 'flex';
            downloadZipBtn.disabled = false;
            await waitForMinimumProcessingDuration(processingStartedAt);
            hideProcessingStatus();
            scrollToDownloadActions();
        } catch (err) {
            if (requestId !== importRequestId) return;
            hideProcessingStatus();
            showFileError(`読み込めませんでした。${err.message}`);
            console.error(err);
        }
    }

    async function regenerateFromSettings(processingStartedAt) {
        try {
            await waitForNextFrame();
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
            await waitForMinimumProcessingDuration(processingStartedAt);
            hideProcessingStatus();
            scrollToDownloadActions();
        } catch (err) {
            hideProcessingStatus();
            alert(`エラーが発生しました:\n${err.message}`);
            console.error(err);
        }
    }

    function refreshExportResult() {
        updateExportResult();
        renderPreview(convertedResult);
        renderSingerMappings(convertedResult.stats.lines);
        outputSection.style.display = 'flex';
        downloadBtn.disabled = false;
        downloadZipBtn.disabled = false;
    }

    function scrollToDownloadActions() {
        requestAnimationFrame(() => {
            const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            outputSection.scrollIntoView({
                behavior: reduceMotion ? 'auto' : 'smooth',
                block: 'start'
            });
        });
    }

    function showProcessingStatus(message) {
        processingMessage.textContent = message;
        processingStatus.hidden = false;
        return performance.now();
    }

    function hideProcessingStatus() {
        processingStatus.hidden = true;
    }

    function waitForNextFrame() {
        return new Promise(resolve => requestAnimationFrame(resolve));
    }

    function waitForMinimumProcessingDuration(processingStartedAt) {
        const elapsed = performance.now() - processingStartedAt;
        const remaining = Math.max(0, PROCESSING_STATUS_MIN_DURATION_MS - elapsed);
        return new Promise(resolve => window.setTimeout(resolve, remaining));
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
                trackNameFormat: getTrackNameFormat(),
                singerMappings: Object.fromEntries(singerMappings)
            }),
            stats: generatedNoteSequence.stats
        };
    }

    async function readCinkFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        const looksLikeZip = bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B;

        if (typeof JSZip !== 'undefined') {
            try {
                const zip = await JSZip.loadAsync(arrayBuffer);
                const archiveSize = getArchiveUncompressedSize(zip);
                if (archiveSize > MAX_ARCHIVE_UNCOMPRESSED_SIZE) {
                    throw new Error(`圧縮ファイルの展開後サイズが上限（${formatFileSize(MAX_ARCHIVE_UNCOMPRESSED_SIZE)}）を超えています。`);
                }

                let jsonFile = zip.file('project.json') || zip.file('projects.json') || zip.file('content.json');
                if (!jsonFile) {
                    const jsonFiles = Object.keys(zip.files).filter(name => name.toLowerCase().endsWith('.json'));
                    if (jsonFiles.length > 0) {
                        jsonFile = zip.file(jsonFiles[0]);
                    }
                }
                if (!jsonFile) {
                    throw new Error('圧縮されたプロジェクト内にJSONデータが見つかりませんでした。');
                }
                const text = await jsonFile.async('text');
                return parseProjectJson(text, '圧縮ファイル内のJSON');
            } catch (err) {
                if (looksLikeZip) {
                    throw err instanceof Error
                        ? err
                        : new Error('圧縮されたプロジェクトを読み込めませんでした。ファイルが破損している可能性があります。');
                }
            }
        }

        try {
            const textDecoder = new TextDecoder('utf-8', { fatal: true });
            return parseCinkText(textDecoder.decode(arrayBuffer));
        } catch (err) {
            if (err instanceof Error && err.message) throw err;
            throw new Error('UTF-8形式のテキストとして読み込めませんでした。');
        }
    }

    /**
     * COEIROINK project files can be plain JSON, but older/exported projects
     * may use an INI-like format beginning with [project].
     */
    function parseCinkText(source) {
        const text = source.replace(/^\uFEFF/, '').trim();
        if (!text) throw new Error('ファイルの内容が空です。');

        try {
            return parseProjectJson(text, 'JSON');
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

    function parseProjectJson(text, sourceLabel) {
        try {
            const data = JSON.parse(text.replace(/^\uFEFF/, ''));
            if (data === null || (typeof data !== 'object')) {
                throw new Error('プロジェクトのJSONがオブジェクト形式ではありません。');
            }
            return data;
        } catch (err) {
            if (err instanceof SyntaxError) {
                throw new Error(`${sourceLabel}の形式が正しくありません。`);
            }
            throw err;
        }
    }

    function validateInputFile(file) {
        if (!file || !file.name) return 'ファイルを選択できませんでした。もう一度お試しください。';
        const extension = getFileExtension(file.name);
        if (!SUPPORTED_FILE_EXTENSIONS.has(extension)) {
            return '対応している形式は .cink、.vvproj です。';
        }
        if (file.size === 0) return '空のファイルは読み込めません。';
        if (file.size > MAX_INPUT_FILE_SIZE) {
            return `ファイルサイズが上限（${formatFileSize(MAX_INPUT_FILE_SIZE)}）を超えています。`;
        }
        return '';
    }

    function getFileExtension(fileName) {
        const match = /\.[^.]+$/.exec(fileName);
        return match ? match[0].toLowerCase() : '';
    }

    function getArchiveUncompressedSize(zip) {
        return Object.values(zip.files).reduce((total, entry) => {
            if (entry.dir) return total;
            const size = Number(entry?._data?.uncompressedSize);
            return Number.isFinite(size) ? total + size : total;
        }, 0);
    }

    function formatFileSize(sizeInBytes) {
        return `${Math.round(sizeInBytes / 1024 / 1024)} MB`;
    }

    function showFileError(message) {
        fileError.textContent = message;
        fileError.hidden = false;
    }

    function clearFileError() {
        fileError.textContent = '';
        fileError.hidden = true;
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

            const trackItem = document.createElement('div');
            trackItem.className = 'track-item';

            const meta = document.createElement('div');
            meta.className = 'track-meta';
            if (speakerLabel) {
                const speaker = document.createElement('span');
                speaker.className = 'track-speaker';
                appendSpeakerIdentity(speaker, lineInfo);

                const dialogue = document.createElement('span');
                dialogue.className = 'track-dialogue-text';
                dialogue.textContent = `「${dialogueText}」`;
                meta.append(speaker, dialogue);
            } else {
                const dialogue = document.createElement('span');
                dialogue.className = 'track-dialogue-text';
                dialogue.textContent = `「${dialogueText}」`;
                meta.appendChild(dialogue);
            }

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
            appendSpeakerIdentity(speakerLabel, speaker);

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

    function appendSpeakerIdentity(element, line) {
        const { speakerName, styleLabel } = getSpeakerIdentityDisplay(line);
        if (!speakerName) return;

        applySpeakerColor(element, line);
        element.appendChild(document.createTextNode(speakerName));

        if (styleLabel) {
            const styleTag = document.createElement('span');
            styleTag.className = 'speaker-style-tag';
            styleTag.textContent = styleLabel;
            element.appendChild(styleTag);
        }
    }

    function applySpeakerColor(element, line) {
        const speakerKey = line?.speaker_uuid || line?.speaker_name || line?.speaker_id;
        if (!speakerKey) return;

        const hue = SPEAKER_HUES[hashText(speakerKey) % SPEAKER_HUES.length];
        const styleKey = line.style_id ?? line.style_name ?? '';
        const variant = STYLE_VARIANTS[hashText(String(styleKey)) % STYLE_VARIANTS.length];
        element.style.setProperty('--speaker-color', `hsl(${hue} 82% 74%)`);
        element.style.setProperty('--style-color', `hsl(${hue} ${variant.saturation}% ${variant.lightness}%)`);
        element.style.setProperty('--style-background', `hsl(${hue} ${variant.saturation}% ${variant.lightness}% / 0.16)`);
    }

    function hashText(value) {
        let hash = 0;
        for (const character of value) {
            hash = ((hash * 31) + character.codePointAt(0)) >>> 0;
        }
        return hash;
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
        if (appMode === 'resync') {
            await downloadResynchronizedZip();
            return;
        }
        if (!generatedNoteSequence || !currentFile) return;
        if (typeof JSZip === 'undefined') {
            alert('ZIP出力用のライブラリを読み込めませんでした。通信状態を確認してから再試行してください。');
            return;
        }
        downloadZipBtn.disabled = true;
        try {
            updateExportResult();
            const includeLab = zipContentInput.checked;
            const baseName = currentFile.name.replace(/\.[^/.]+$/, "");
            const zip = new JSZip();
            const labOutputs = [];
            zip.file(`${baseName}.ustx`, convertedResult.ustxYaml);

            convertedResult.ustxDict.voice_parts.forEach((part, index) => {
                const track = convertedResult.ustxDict.tracks[index];
                const trackName = track.track_name;
                const outputStem = `Export/${baseName}_${trackName}`;
                zip.file(`${outputStem}.txt`, part.name);
                if (includeLab) {
                    const lab = buildLabFile(part.notes, convertedResult.ustxDict.bpm);
                    zip.file(`${outputStem}.lab`, lab.content);
                    labOutputs.push({ path: `${outputStem}.lab`, labelCount: lab.labelCount, warnings: lab.warnings });
                }
            });
            zip.file(`Log/${baseName}_conversion.log`, buildConversionLog(baseName, { includeLab, labOutputs }));

            const blob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(blob, `${baseName}.zip`);
            clearFileError();
        } catch (err) {
            showFileError(`ZIPを出力できませんでした。${err.message}`);
            console.error(err);
        } finally {
            downloadZipBtn.disabled = false;
        }
    });

    async function downloadResynchronizedZip() {
        if (!resyncProject || !currentFile) return;
        if (typeof JSZip === 'undefined') {
            alert('ZIP出力用のライブラリを読み込めませんでした。通信状態を確認してから再試行してください。');
            return;
        }

        downloadZipBtn.disabled = true;
        try {
            const includeLab = zipContentInput.checked;
            const baseName = currentFile.name.replace(/\.[^/.]+$/, '');
            const output = buildResynchronizedOutput(resyncProject, getTrackNameFormat(), includeLab);
            const zip = new JSZip();
            zip.file(`${baseName}.ustx`, output.ustxYaml);
            output.tracks.forEach(track => {
                const outputStem = `Export/${baseName}_${track.trackName}`;
                zip.file(`${outputStem}.txt`, track.text);
                if (includeLab) zip.file(`${outputStem}.lab`, track.lab.content);
            });
            zip.file(`Log/${baseName}_resync.log`, buildResyncLog(baseName, output, includeLab));
            const blob = await zip.generateAsync({ type: 'blob' });
            triggerDownload(blob, `${baseName}.zip`);
            clearFileError();
        } catch (err) {
            showFileError(`再同期ZIPを出力できませんでした。${err.message}`);
            console.error(err);
        } finally {
            downloadZipBtn.disabled = false;
        }
    }

    function buildLabFile(notes, bpm) {
        if (!Number.isFinite(Number(bpm)) || Number(bpm) <= 0) {
            throw new Error('LABの時刻を計算するためのBPMが正しくありません。');
        }

        let carriedVowel = '';
        const warnings = [];
        const lines = notes.map((note, index) => {
            const startTick = Number(note.position);
            const endTick = startTick + Number(note.duration);
            if (!Number.isFinite(startTick) || !Number.isFinite(endTick) || endTick < startTick) {
                throw new Error(`LABの${index + 1}番目のノート時刻が正しくありません。`);
            }

            const labelResult = getLabLabel(note.lyric, carriedVowel);
            const { label } = labelResult;
            if (labelResult.warning) {
                warnings.push({
                    noteIndex: index + 1,
                    position: startTick,
                    lyric: String(note.lyric ?? '') || '(空欄)',
                    reason: labelResult.warning
                });
            }
            if (['a', 'i', 'u', 'e', 'o'].includes(label)) {
                carriedVowel = label;
            } else if (!labelResult.inheritsVowel) {
                carriedVowel = '';
            }
            const start = formatLabTime(ticksToLabTime(startTick, bpm));
            const end = formatLabTime(ticksToLabTime(endTick, bpm));
            return `${start} ${end} ${label}`;
        });

        return { content: `${lines.join('\n')}\n`, labelCount: lines.length, warnings };
    }

    async function readUstxProject(file) {
        if (typeof jsyaml === 'undefined') {
            throw new Error('USTXを読み込むためのライブラリを読み込めませんでした。');
        }
        let data;
        try {
            data = jsyaml.load((await file.text()).replace(/^\uFEFF/, ''));
        } catch (_) {
            throw new Error('USTXのYAML形式が正しくありません。');
        }
        return validateResyncProject(data);
    }

    function validateResyncProject(data) {
        if (!data || typeof data !== 'object' || Array.isArray(data)) {
            throw new Error('USTXプロジェクトの内容が正しくありません。');
        }
        if (!Array.isArray(data.tracks) || !Array.isArray(data.voice_parts)) {
            throw new Error('USTXにトラックまたはボイスパートが見つかりません。');
        }
        const resolution = Number(data.resolution || USTX_TICKS_PER_QUARTER);
        if (!Number.isFinite(resolution) || resolution <= 0) {
            throw new Error('USTXのresolutionが正しくありません。');
        }
        if (!Array.isArray(data.tempos) || data.tempos.length === 0) {
            throw new Error('USTXにテンポ情報が見つかりません。');
        }
        const tempos = data.tempos.map((tempo, index) => {
            const position = Number(tempo?.position);
            const bpm = Number(tempo?.bpm);
            if (!Number.isFinite(position) || position < 0 || !Number.isFinite(bpm) || bpm <= 0) {
                throw new Error(`USTXの${index + 1}番目のテンポが正しくありません。`);
            }
            return { position, bpm };
        }).sort((a, b) => a.position - b.position);
        if (tempos[0].position !== 0) {
            throw new Error('USTXの先頭テンポが0 ticksに設定されていません。');
        }

        const tracks = data.tracks.map((track, index) => {
            if (!track || typeof track !== 'object') {
                throw new Error(`USTXの${index + 1}番目のトラックが正しくありません。`);
            }
            return { index, singer: typeof track.singer === 'string' ? track.singer : '', originalName: String(track.track_name ?? '') };
        });
        const partsByTrack = tracks.map(() => []);
        data.voice_parts.forEach((part, partIndex) => {
            const trackIndex = Number(part?.track_no);
            const position = Number(part?.position);
            if (!Number.isInteger(trackIndex) || trackIndex < 0 || trackIndex >= tracks.length || !Number.isFinite(position) || position < 0 || !Array.isArray(part?.notes)) {
                throw new Error(`USTXの${partIndex + 1}番目のボイスパートが正しくありません。`);
            }
            const notes = part.notes.map((note, noteIndex) => {
                const notePosition = Number(note?.position);
                const duration = Number(note?.duration);
                if (!Number.isFinite(notePosition) || notePosition < 0 || !Number.isFinite(duration) || duration <= 0) {
                    throw new Error(`USTXのパート${partIndex + 1}・ノート${noteIndex + 1}の位置または長さが正しくありません。`);
                }
                return { position: position + notePosition, duration, lyric: String(note?.lyric ?? ''), partIndex, noteIndex };
            });
            partsByTrack[trackIndex].push({ partIndex, position, name: String(part.name ?? ''), notes });
        });

        const normalizedTracks = tracks.map(track => {
            const parts = partsByTrack[track.index].sort((a, b) => a.position - b.position || a.partIndex - b.partIndex);
            const notes = parts.flatMap(part => part.notes).sort((a, b) => a.position - b.position || a.partIndex - b.partIndex || a.noteIndex - b.noteIndex);
            let previousEnd = 0;
            notes.forEach((note, index) => {
                if (index > 0 && note.position < previousEnd) {
                    throw new Error(`トラック${track.index + 1}に重なるノートがあります。重なるノートは別トラックへ分けてください。`);
                }
                previousEnd = note.position + note.duration;
            });
            return { ...track, parts, notes };
        });
        return { data, resolution, tempos, tracks: normalizedTracks };
    }

    function buildResynchronizedOutput(project, format, includeLab) {
        const outputDict = jsyaml.load(jsyaml.dump(project.data, { noRefs: true }));
        const tracks = project.tracks.map(track => {
            const text = track.parts.map(part => part.name).join('');
            const trackName = createResyncTrackName(track.index, track.singer, text, format);
            outputDict.tracks[track.index].track_name = trackName;
            const lab = includeLab ? buildResyncLabFile(track.notes, project.tempos, project.resolution) : null;
            const warnings = [];
            if (track.parts.length === 0) warnings.push('ボイスパートがありません。空のTXTを出力しました。');
            track.parts.forEach(part => {
                if (!part.name) warnings.push(`パート${part.partIndex + 1}のアイテム名が空です。`);
            });
            return { ...track, text, trackName, lab, warnings };
        });
        return {
            ustxYaml: jsyaml.dump(outputDict, { noRefs: true, lineWidth: -1 }),
            tracks,
            internalName: String(project.data.name ?? ''),
            tempoCount: project.tempos.length
        };
    }

    function createResyncTrackName(index, singer, text, format) {
        const ordinal = String(index + 1).padStart(3, '0');
        const textFragment = filenameFragment(text, 32);
        if (format === 'number') return ordinal;
        if (format === 'number-text') return textFragment ? `${ordinal}_${textFragment}` : ordinal;
        const singerFragment = singerFilenameFragment(singer, 8) || 'singer';
        return textFragment ? `${ordinal}_${singerFragment}_${textFragment}` : `${ordinal}_${singerFragment}`;
    }

    function buildResyncLabFile(notes, tempos, resolution) {
        let carriedVowel = '';
        let cursor = 0;
        const warnings = [];
        const rows = [];
        const appendRow = (startTick, endTick, label) => {
            if (endTick <= startTick) return;
            rows.push(`${formatLabTime(ticksToLabTimeWithTempos(startTick, tempos, resolution))} ${formatLabTime(ticksToLabTimeWithTempos(endTick, tempos, resolution))} ${label}`);
        };
        notes.forEach((note, index) => {
            if (note.position > cursor) {
                appendRow(cursor, note.position, 'sil');
                carriedVowel = '';
            }
            const result = getLabLabel(note.lyric, carriedVowel);
            appendRow(note.position, note.position + note.duration, result.label);
            if (result.warning) {
                warnings.push({
                    noteIndex: index + 1,
                    position: note.position,
                    lyric: note.lyric || '(空欄)',
                    reason: result.warning
                });
            }
            if (['a', 'i', 'u', 'e', 'o'].includes(result.label)) carriedVowel = result.label;
            else if (!result.inheritsVowel) carriedVowel = '';
            cursor = note.position + note.duration;
        });
        return { content: `${rows.join('\n')}${rows.length ? '\n' : ''}`, labelCount: rows.length, warnings };
    }

    function ticksToLabTimeWithTempos(targetTick, tempos, resolution) {
        let elapsed = 0;
        for (let index = 0; index < tempos.length; index += 1) {
            const tempo = tempos[index];
            const nextPosition = tempos[index + 1]?.position ?? targetTick;
            if (targetTick <= tempo.position) break;
            const end = Math.min(targetTick, nextPosition);
            if (end > tempo.position) {
                elapsed += ((end - tempo.position) * 60 * LAB_TIME_UNITS_PER_SECOND) / (resolution * tempo.bpm);
            }
            if (targetTick <= nextPosition) break;
        }
        return Math.round(elapsed);
    }

    function buildResyncLog(baseName, output, includeLab) {
        const lines = [
            'HANAX-U USTX Resynchronization Log',
            `Generated (UTC): ${new Date().toISOString()}`,
            '',
            '[Source]',
            `file: ${currentFile.name}`,
            'format: USTX resynchronization',
            `internal_name: ${output.internalName || '(not set)'}`,
            `tempo_entries: ${output.tempoCount}`,
            '',
            '[Output settings]',
            `track_name_format: ${getTrackNameFormat()}`,
            `zip_content: ${includeLab ? 'TXT・LAB' : 'TXTのみ'}`,
            `ustx: ${baseName}.ustx`,
            '',
            '[Tracks]'
        ];
        output.tracks.forEach(track => {
            lines.push(`- ${track.trackName}`);
            lines.push(`  original_track_name: ${track.originalName || '(not set)'}`);
            lines.push(`  singer: ${track.singer || '(not set)'}`);
            lines.push(`  text_file: Export/${baseName}_${track.trackName}.txt`);
            lines.push(`  text: ${track.text}`);
            track.warnings.forEach(warning => lines.push(`  warning: ${warning}`));
            if (includeLab) {
                lines.push(`  lab_file: Export/${baseName}_${track.trackName}.lab`);
                lines.push(`  lab_labels: ${track.lab.labelCount}`);
                track.lab.warnings.forEach(warning => lines.push(`  lab_warning: note ${warning.noteIndex}, position ${warning.position}, lyric ${JSON.stringify(warning.lyric)}, replaced with sil (${warning.reason})`));
            }
        });
        return `${lines.join('\n')}\n`;
    }

    function ticksToLabTime(tick, bpm) {
        return Math.round((tick * 60 * LAB_TIME_UNITS_PER_SECOND) / (USTX_TICKS_PER_QUARTER * Number(bpm)));
    }

    function formatLabTime(value) {
        return String(value).padStart(5, '0');
    }

    function getTrackNameFormat() {
        return Array.from(trackNameFormatInputs).find(input => input.checked)?.value || 'number';
    }

    function getLabLabel(lyric, carriedVowel) {
        if (lyric === 'R') return { label: 'sil' };

        const sourceLyric = String(lyric || '');
        if (isLabExtender(sourceLyric)) {
            if (['a', 'i', 'u', 'e', 'o'].includes(carriedVowel)) {
                return { label: carriedVowel, inheritsVowel: true };
            }
            return { label: 'sil', warning: '伸ばし記号の直前に引き継げる母音がありません。' };
        }

        const hiragana = toHiragana(sourceLyric.normalize('NFKC'));
        if (hiragana === 'ん') return { label: 'N' };
        const characters = Array.from(hiragana);
        let target = characters.at(-1);
        if (isLabExtender(target) && characters.length > 1) {
            target = characters.at(-2);
        }

        const vowel = getVowelFromKana(target);
        if (!vowel) {
            return { label: 'sil', warning: '母音をLABラベルへ変換できません。' };
        }
        return { label: vowel };
    }

    function isLabExtender(lyric) {
        const normalized = String(lyric || '').normalize('NFKC');
        return normalized === '+' || normalized === '-' || normalized === 'ー';
    }

    function toHiragana(text) {
        return Array.from(text, character => {
            const code = character.codePointAt(0);
            return code >= 0x30A1 && code <= 0x30F6 ? String.fromCodePoint(code - 0x60) : character;
        }).join('');
    }

    function getVowelFromKana(character) {
        const vowelGroups = {
            a: 'ぁあかがさざただなはばぱまやらわゎゃ',
            i: 'ぃいきぎしじちぢにひびぴみりゐ',
            u: 'ぅうくぐすずつづぬふぶぷむゆるゔゅ',
            e: 'ぇえけげせぜてでねへべぺめれゑ',
            o: 'ぉおこごそぞとどのほぼぽもよろをょ'
        };
        return Object.entries(vowelGroups).find(([, characters]) => characters.includes(character))?.[0] || '';
    }

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

    function buildConversionLog(baseName, { includeLab = false, labOutputs = [] } = {}) {
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
            `track_name_format: ${trackNameFormatLabels[getTrackNameFormat()] || getTrackNameFormat()}`,
            `zip_content: ${includeLab ? 'TXT・LAB' : 'TXTのみ'}`,
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
            if (includeLab) {
                const labOutput = labOutputs[index];
                lines.push(`  lab_file: ${labOutput.path}`);
                lines.push(`  lab_labels: ${labOutput.labelCount}`);
                labOutput.warnings.forEach(warning => {
                    lines.push(`  lab_warning: note ${warning.noteIndex}, position ${warning.position}, lyric ${JSON.stringify(warning.lyric)}, replaced with sil (${warning.reason})`);
                });
            }
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
        const { speakerName, styleLabel } = getSpeakerIdentityDisplay(line);
        if (!speakerName) return "";
        return styleLabel ? `${speakerName}（${styleLabel}）` : speakerName;
    }

    function getSpeakerIdentityDisplay(line) {
        const speakerName = line.speaker_name || "";
        const styleLabel = line.style_name || (line.style_id !== null && line.style_id !== undefined ? String(line.style_id) : "");
        return { speakerName, styleLabel };
    }
});

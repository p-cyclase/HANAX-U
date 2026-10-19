/**
 * filename-rules.js - HANAX-U の共通ファイル命名規則
 *
 * 通常変換とUSTX整頓モードのトラック名・TXT・LAB・Wav対応に使う。
 */

const FILE_NAME_RULES = Object.freeze({
    trackNumberDigits: 3,
    singerMaxLength: 8,
    textMaxLength: 24
});

function filenameFragment(value, maxLength) {
    const safe = String(value ?? '')
        .replace(/\uFFFD/g, '')
        .trim()
        .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_')
        .replace(/\s+/g, ' ')
        .replace(/[. ]+$/g, '');
    return Array.from(safe).slice(0, maxLength).join('');
}

function singerFilenameFragment(singer) {
    const source = String(singer ?? '').replace(/\uFFFD/g, '').trim();
    const lowestFolderName = source.split(/[\\/]+/).filter(Boolean).pop() || source;
    return filenameFragment(lowestFolderName, FILE_NAME_RULES.singerMaxLength);
}

function createOutputTrackName(index, options = {}) {
    const text = options.text || '';
    const singer = options.singer || '';
    const fallbackSinger = options.fallbackSinger || 'singer';
    const format = options.format || 'number';
    const ordinal = String(index + 1).padStart(FILE_NAME_RULES.trackNumberDigits, '0');
    if (format === 'number') return ordinal;

    const textFragment = filenameFragment(text, FILE_NAME_RULES.textMaxLength);
    if (format === 'number-text') return textFragment ? ordinal + '_' + textFragment : ordinal;

    const singerFragment = singerFilenameFragment(singer);
    const resolvedSinger = singerFragment
        || filenameFragment(fallbackSinger, FILE_NAME_RULES.singerMaxLength)
        || 'singer';
    return textFragment ? ordinal + '_' + resolvedSinger + '_' + textFragment : ordinal + '_' + resolvedSinger;
}

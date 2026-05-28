const fs = require('fs');
const path = require('path');

function fixFile(filePath, type) {
  let content = fs.readFileSync(filePath, 'utf8');
  if (type === 'class') {
    content = content.replace(/^ AudioAnalyzer/gm, 'class AudioAnalyzer');
    content = content.replace(/^ SilenceSkipper/gm, 'class SilenceSkipper');
    content = content.replace(/^ SpeedController/gm, 'class SpeedController');
    content = content.replace(/^ TranscriptFetcher/gm, 'class TranscriptFetcher');
    content = content.replace(/^ FillerTrimmer/gm, 'class FillerTrimmer');
    content = content.replace(/^ ChapterReader/gm, 'class ChapterReader');
    content = content.replace(/^ ModeDetector/gm, 'class ModeDetector');
    content = content.replace(/^ ChannelMemory/gm, 'class ChannelMemory');
    content = content.replace(/^ TimeTracker/gm, 'class TimeTracker');
  } else if (type === 'const') {
    content = content.replace(/^ DEFAULT_SETTINGS/gm, 'const DEFAULT_SETTINGS');
    content = content.replace(/^ FILLER_WORDS/gm, 'const FILLER_WORDS');
    content = content.replace(/^ getStorage/gm, 'const getStorage');
    content = content.replace(/^ setStorage/gm, 'const setStorage');
    content = content.replace(/^ removeStorage/gm, 'const removeStorage');
    content = content.replace(/^ sendToContent/gm, 'const sendToContent');
    content = content.replace(/^ sendToBackground/gm, 'const sendToBackground');
  }
  fs.writeFileSync(filePath, content);
}

const contentFiles = [
  'audio-analyzer.js', 'silence-skipper.js', 'speed-controller.js',
  'transcript-fetcher.js', 'filler-trimmer.js', 'chapter-reader.js',
  'mode-detector.js', 'channel-memory.js', 'time-tracker.js'
];
contentFiles.forEach(f => fixFile(path.join('content', f), 'class'));

const utilsFiles = ['constants.js', 'storage.js', 'messaging.js'];
utilsFiles.forEach(f => fixFile(path.join('utils', f), 'const'));

console.log("Fixed files.");

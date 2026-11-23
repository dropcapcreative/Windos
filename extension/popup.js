'use strict';

const DEFAULTS = {
  autoStart: 'music',
  autoCycle: true,
  cycleSeconds: 30,
  preset: 0,
  mode: 'cover',
  blendOpacity: 0.7,
};

const $ = (id) => document.getElementById(id);
const status = $('status');

const presetSel = $('preset');
RetrowaveVisualizer.presetNames.forEach((name, i) => {
  const o = document.createElement('option');
  o.value = String(i);
  o.textContent = name;
  presetSel.appendChild(o);
});

function syncOpacityRow() {
  $('opacityRow').style.display = $('mode').value === 'blend' ? '' : 'none';
}

chrome.storage.sync.get(DEFAULTS, (s) => {
  $('autoStart').value = s.autoStart;
  presetSel.value = String(s.preset);
  $('autoCycle').checked = !!s.autoCycle;
  $('cycleSeconds').value = s.cycleSeconds;
  $('mode').value = s.mode;
  $('blendOpacity').value = s.blendOpacity;
  syncOpacityRow();
});

const save = (obj) => chrome.storage.sync.set(obj);
$('autoStart').addEventListener('change', (e) => save({ autoStart: e.target.value }));
presetSel.addEventListener('change', (e) => save({ preset: Number(e.target.value) }));
$('autoCycle').addEventListener('change', (e) => save({ autoCycle: e.target.checked }));
$('cycleSeconds').addEventListener('change', (e) => {
  const v = Math.max(5, Math.min(600, Number(e.target.value) || 30));
  e.target.value = v;
  save({ cycleSeconds: v });
});
$('mode').addEventListener('change', (e) => {
  save({ mode: e.target.value });
  syncOpacityRow();
});
$('blendOpacity').addEventListener('input', (e) => save({ blendOpacity: Number(e.target.value) }));

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

$('toggle').addEventListener('click', async () => {
  const tab = await activeTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'retrowave:toggle' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      status.textContent = 'Open a YouTube or YouTube Music tab first (reload it if you just installed this).';
      return;
    }
    status.textContent = res.visible ? 'Visualizer on.' : 'Visualizer off.';
  });
});

activeTab().then((tab) => {
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: 'retrowave:status' }, (res) => {
    if (chrome.runtime.lastError || !res) {
      status.textContent = 'Works on youtube.com and music.youtube.com.';
      return;
    }
    status.textContent = res.visible ? `Playing: ${res.preset}` : 'Visualizer is off on this tab.';
  });
});

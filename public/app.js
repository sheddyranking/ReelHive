// ReelHive front end. Plain JavaScript, no framework.
// Talks to the REST API (/api/videos ...) and builds the vertical video feed.

// ---------------------------------------------------------------- state
const state = {
  view: 'new',          // 'new' | 'popular' | 'saved'
  query: '',            // search text
  videos: [],           // videos currently shown
  index: 0,             // which slide is on screen
  muted: true,          // browsers only allow autoplay when muted; user can unmute once
  commentsFor: null,    // id of video whose comments are open
};
const viewed = new Set(); // videos already counted as viewed this session

// ---------------------------------------------------------------- elements
const $ = (sel) => document.querySelector(sel);
const feed = $('#feed');
const empty = $('#empty');
const toastEl = $('#toast');

// ---------------------------------------------------------------- icons (static, trusted SVG)
const ICONS = {
  heart: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
  comment: '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>',
  save: '<svg viewBox="0 0 24 24"><path d="M6 3h12v18l-6-4-6 4z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><path d="M14 4l7 7-7 7v-4c-5 0-8 1.5-10 5 .5-5.5 3.5-9.5 10-10z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4l13 8-13 8z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M7 4h3v16H7zM14 4h3v16h-3z"/></svg>',
  soundOn: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
  soundOff: '<svg viewBox="0 0 24 24"><path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M17 9l5 6M22 9l-5 6"/></svg>',
  heartFilled: '<svg viewBox="0 0 24 24"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>',
};
function icon(name, cls = '') {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.innerHTML = ICONS[name]; // constants above only, never user data
  return span;
}

// ---------------------------------------------------------------- helpers
// el('p', {class: 'x'}, 'text') builds DOM safely (user text goes in as text, never HTML)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === false || v == null) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children) if (c != null && c !== false) node.append(c);
  return node;
}

function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => compact.format(n);
const viewsText = (n) => `${fmt(n)} ${n === 1 ? 'view' : 'views'}`;

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 604800) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function clock(sec) {
  if (!Number.isFinite(sec)) return '00:00';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// Coloured initials avatar: the colour is derived from the name so it stays the same.
function avatar(name, small = false) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  const a = el('span', { class: small ? 'avatar sm' : 'avatar', 'aria-hidden': 'true' }, name.slice(0, 1) || '?');
  a.style.background = `hsl(${hash} 70% 66%)`;
  return a;
}

// Browser storage for per-viewer things (liked / saved / your name).
function getSet(key) {
  try { return new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { return new Set(); }
}
function putSet(key, set) {
  try { localStorage.setItem(key, JSON.stringify([...set])); } catch { /* storage unavailable */ }
}
function getPref(key) { try { return localStorage.getItem(key) || ''; } catch { return ''; } }
function setPref(key, v) { try { localStorage.setItem(key, v); } catch { /* ignore */ } }

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// Turn "#tags" in a caption into clickable search buttons.
function captionNodes(text) {
  return text.split(/(#[\w-]+)/g).filter(Boolean).map((part) => (
    part.startsWith('#')
      ? el('button', { class: 'tag', onclick: (e) => { e.stopPropagation(); search(part); } }, part)
      : document.createTextNode(part)
  ));
}

// ---------------------------------------------------------------- building a slide
function buildSlide(v, i) {
  const liked = getSet('rh-liked');
  const saved = getSet('rh-saved');

  // --- video + overlays
  const video = el('video', { src: v.url, loop: true, playsinline: true, preload: i < 2 ? 'auto' : 'metadata', 'data-id': v.id });
  video.muted = true;

  const playBtn = el('button', { 'aria-label': 'Play or pause', class: 'fill' }, icon('play'));
  const muteBtn = el('button', { 'aria-label': 'Mute or unmute' }, icon('soundOff'));
  const speedBtn = el('button', { class: 'speed', 'aria-label': 'Playback speed' }, '1.0x');
  const time = el('span', { class: 'time' }, '00:00 / 00:00');
  const bar = el('div', { class: 'bar' });
  const seek = el('input', { type: 'range', min: 0, max: 1000, value: 0, 'aria-label': 'Seek' });

  const isNew = Date.now() - new Date(v.createdAt) < 24 * 3600 * 1000;
  // inner <span> keeps the spaces between #tags (the clamped <p> is a flex-like box)
  const caption = v.description ? el('p', { class: 'caption' }, el('span', {}, ...captionNodes(v.description))) : null;
  const viewsBadge = el('span', { class: 'badge', 'data-views': v.id }, viewsText(v.views));
  const moreBtn = v.description && v.description.length > 90
    ? el('button', { class: 'more', onclick: (e) => { e.stopPropagation(); caption.classList.toggle('open'); moreBtn.textContent = caption.classList.contains('open') ? 'less' : 'more'; } }, 'more')
    : null;

  const player = el('div', { class: 'player paused' },
    video,
    el('div', { class: 'shade-top' }),
    el('div', { class: 'shade' }),
    el('div', { class: 'top-row' }, isNew ? el('span', { class: 'badge new' }, 'New') : el('span'), viewsBadge),
    el('div', { class: 'big-play' }, icon('play')),
    el('div', { class: 'info' },
      el('p', { class: 'creator-line' }, avatar(v.creator, true), `@${v.creator}`, el('span', { class: 'stamp' }, `· ${timeAgo(v.createdAt)}`)),
      el('p', { class: 'title' }, v.title),
      caption, moreBtn),
    el('div', { class: 'controls' }, playBtn, time, el('span', { class: 'spacer' }), speedBtn, muteBtn),
    el('div', { class: 'seek' }, bar, seek));

  // --- player behaviour
  const setPlayIcon = () => {
    player.classList.toggle('paused', video.paused);
    playBtn.replaceChildren(icon(video.paused ? 'play' : 'pause'));
  };
  video.addEventListener('play', setPlayIcon);
  video.addEventListener('pause', setPlayIcon);
  video.addEventListener('timeupdate', () => {
    const pct = video.duration ? video.currentTime / video.duration : 0;
    bar.style.width = `${pct * 100}%`;
    seek.value = Math.round(pct * 1000);
    time.textContent = `${clock(video.currentTime)} / ${clock(video.duration)}`;
  });
  video.addEventListener('loadedmetadata', () => { time.textContent = `00:00 / ${clock(video.duration)}`; });
  seek.addEventListener('input', () => { if (video.duration) video.currentTime = (seek.value / 1000) * video.duration; });
  playBtn.addEventListener('click', () => togglePlay(video));
  muteBtn.addEventListener('click', () => setMuted(!state.muted));
  const speeds = [1, 1.5, 2, 0.5];
  speedBtn.addEventListener('click', () => {
    const next = speeds[(speeds.indexOf(video.playbackRate) + 1) % speeds.length];
    video.playbackRate = next;
    speedBtn.textContent = `${next.toFixed(1)}x`;
  });

  // single click = play/pause, double click = like (with a heart burst)
  let clickTimer;
  video.addEventListener('click', () => {
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => togglePlay(video), 220);
  });
  video.addEventListener('dblclick', (e) => {
    clearTimeout(clickTimer);
    const rect = player.getBoundingClientRect();
    const burst = el('span', { class: 'burst' }, icon('heartFilled'));
    burst.style.left = `${e.clientX - rect.left}px`;
    burst.style.top = `${e.clientY - rect.top}px`;
    player.append(burst);
    setTimeout(() => burst.remove(), 800);
    if (!getSet('rh-liked').has(v.id)) likeBtn.click();
  });

  // --- action rail
  const likeCount = el('span', {}, fmt(v.likes));
  const likeBtn = el('button', { class: liked.has(v.id) ? 'on' : '', 'aria-label': 'Like' }, el('span', { class: 'ic' }, icon('heart')), likeCount);
  likeBtn.addEventListener('click', async () => {
    const set = getSet('rh-liked');
    const undo = set.has(v.id);
    try {
      const r = await api(`/api/videos/${v.id}/${undo ? 'unlike' : 'like'}`, { method: 'POST' });
      v.likes = r.likes;
      likeCount.textContent = fmt(r.likes);
      if (undo) set.delete(v.id); else set.add(v.id);
      putSet('rh-liked', set);
      likeBtn.classList.toggle('on', !undo);
    } catch (e) { toast(e.message); }
  });

  const commentCount = el('span', { 'data-comment-count': v.id }, fmt(v.comments.length));
  const commentBtn = el('button', { 'aria-label': 'Comments', onclick: () => openComments(v) }, el('span', { class: 'ic' }, icon('comment')), commentCount);

  const saveBtn = el('button', { class: saved.has(v.id) ? 'on' : '', 'aria-label': 'Save' }, el('span', { class: 'ic' }, icon('save')), saved.has(v.id) ? 'Saved' : 'Save');
  saveBtn.addEventListener('click', () => {
    const set = getSet('rh-saved');
    const on = !set.has(v.id);
    if (on) set.add(v.id); else set.delete(v.id);
    putSet('rh-saved', set);
    saveBtn.classList.toggle('on', on);
    saveBtn.lastChild.textContent = on ? 'Saved' : 'Save';
    toast(on ? 'Saved to your collection' : 'Removed from saved');
  });

  const shareBtn = el('button', { 'aria-label': 'Share' }, el('span', { class: 'ic' }, icon('share')), 'Share');
  shareBtn.addEventListener('click', async () => {
    const link = `${location.origin}/?v=${v.id}`;
    try { await navigator.clipboard.writeText(link); toast('Link copied'); } catch { prompt('Copy this link:', link); }
  });

  const delBtn = el('button', { class: 'del', 'aria-label': 'Delete' }, el('span', { class: 'ic' }, icon('trash')), 'Delete');
  delBtn.addEventListener('click', async () => {
    if (!delBtn.classList.contains('confirm')) {
      delBtn.classList.add('confirm');
      delBtn.lastChild.textContent = 'Sure?';
      setTimeout(() => { delBtn.classList.remove('confirm'); delBtn.lastChild.textContent = 'Delete'; }, 3000);
      return;
    }
    try {
      await api(`/api/videos/${v.id}`, { method: 'DELETE' });
      toast('Video deleted');
      loadFeed();
    } catch (e) { toast(e.message); }
  });

  const rail = el('div', { class: 'rail' },
    el('button', { 'aria-label': `Search videos by ${v.creator}`, onclick: () => search(v.creator) }, avatar(v.creator)),
    likeBtn, commentBtn, saveBtn, shareBtn, delBtn);

  return el('article', { class: 'slide', 'data-index': i }, player, rail);
}

// ---------------------------------------------------------------- playback control
function activeVideo() {
  return feed.querySelector(`.slide[data-index="${state.index}"] video`);
}
function togglePlay(video = activeVideo()) {
  if (!video) return;
  if (video.paused) video.play().catch(() => {}); else video.pause();
}
function setMuted(muted) {
  state.muted = muted;
  feed.querySelectorAll('video').forEach((vid) => { vid.muted = muted; });
  feed.querySelectorAll('.controls button[aria-label="Mute or unmute"]').forEach((b) => b.replaceChildren(icon(muted ? 'soundOff' : 'soundOn')));
}

// The slide that is mostly on screen becomes "active": it plays, the others pause.
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting && entry.intersectionRatio >= 0.6) setActive(Number(entry.target.dataset.index));
  }
}, { root: feed, threshold: [0.6] });

function setActive(i) {
  state.index = i;
  feed.querySelectorAll('.slide').forEach((slide) => {
    const vid = slide.querySelector('video');
    if (Number(slide.dataset.index) === i) {
      vid.muted = state.muted;
      vid.play().catch(() => {});
      const id = vid.dataset.id;
      if (!viewed.has(id)) {
        viewed.add(id);
        api(`/api/videos/${id}/view`, { method: 'POST' })
          .then((r) => {
            const badge = feed.querySelector(`[data-views="${id}"]`);
            if (badge) badge.textContent = viewsText(r.views);
          })
          .catch(() => {});
      }
    } else {
      vid.pause();
    }
  });
  $('#prevBtn').disabled = i <= 0;
  $('#nextBtn').disabled = i >= state.videos.length - 1;
}

function goTo(i) {
  const slide = feed.querySelector(`.slide[data-index="${i}"]`);
  if (slide) slide.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ---------------------------------------------------------------- loading the feed
function showSkeleton() {
  feed.replaceChildren(el('article', { class: 'slide' }, el('div', { class: 'player skeleton' })));
}

async function loadFeed({ focusId } = {}) {
  showSkeleton();
  empty.hidden = true;
  try {
    const params = new URLSearchParams({ sort: state.view === 'popular' ? 'popular' : 'new' });
    if (state.query) params.set('q', state.query);
    let videos = await api(`/api/videos?${params}`);
    if (state.view === 'saved') {
      const saved = getSet('rh-saved');
      videos = videos.filter((v) => saved.has(v.id));
    }
    state.videos = videos;
    observer.disconnect();
    feed.replaceChildren(...videos.map(buildSlide));
    feed.querySelectorAll('.slide').forEach((s) => observer.observe(s));
    feed.scrollTop = 0;
    state.index = 0;
    showEmptyState(videos.length === 0);
    if (videos.length) {
      const start = Math.max(0, videos.findIndex((v) => v.id === focusId));
      if (start > 0) feed.querySelector(`.slide[data-index="${start}"]`).scrollIntoView();
      setActive(start);
    } else {
      $('#prevBtn').disabled = true;
      $('#nextBtn').disabled = true;
    }
  } catch (e) {
    feed.replaceChildren();
    toast(`Could not load videos: ${e.message}`);
  }
}

function showEmptyState(isEmpty) {
  empty.hidden = !isEmpty;
  if (!isEmpty) return;
  const action = $('#emptyAction');
  action.onclick = null;
  if (state.query) {
    $('#emptyTitle').textContent = `No results for “${state.query}”`;
    $('#emptyText').textContent = 'Try another word or #tag.';
    action.textContent = 'Clear search';
    action.removeAttribute('data-open-upload');
    action.onclick = clearSearch;
  } else if (state.view === 'saved') {
    $('#emptyTitle').textContent = 'Nothing saved yet';
    $('#emptyText').textContent = 'Tap the bookmark on any video to keep it here.';
    action.textContent = 'Browse videos';
    action.removeAttribute('data-open-upload');
    action.onclick = () => setView('new');
  } else {
    $('#emptyTitle').textContent = 'The hive is empty';
    $('#emptyText').textContent = 'Be the first to share a short video.';
    action.textContent = 'Upload a video';
    action.onclick = openUpload;
  }
}

// ---------------------------------------------------------------- views + search
function setView(view) {
  state.view = view;
  document.querySelectorAll('[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  loadFeed();
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));

const searchInput = $('#searchInput');
function search(text) {
  state.query = text.trim();
  searchInput.value = state.query;
  $('#filterChip').hidden = !state.query;
  $('#filterText').textContent = `Results for “${state.query}”`;
  document.body.classList.remove('search-open');
  loadFeed();
}
function clearSearch() { search(''); }

let searchTimer;
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => search(searchInput.value), 350);
});
$('#searchForm').addEventListener('submit', (e) => { e.preventDefault(); clearTimeout(searchTimer); search(searchInput.value); });
$('#clearFilter').addEventListener('click', clearSearch);
$('#mSearchBtn').addEventListener('click', () => { document.body.classList.add('search-open'); searchInput.focus(); });

$('#prevBtn').addEventListener('click', () => goTo(state.index - 1));
$('#nextBtn').addEventListener('click', () => goTo(state.index + 1));

// Keyboard shortcuts (ignored while typing or when a dialog is open)
document.addEventListener('keydown', (e) => {
  const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (e.key === 'Escape') {
    closeComments();
    document.body.classList.remove('search-open');
    return;
  }
  if (typing || document.querySelector('dialog[open]')) return;
  if (e.key === 'ArrowDown' || e.key === 'j') { e.preventDefault(); goTo(state.index + 1); }
  else if (e.key === 'ArrowUp' || e.key === 'k') { e.preventDefault(); goTo(state.index - 1); }
  else if (e.key === ' ') { e.preventDefault(); togglePlay(); }
  else if (e.key === 'm') setMuted(!state.muted);
});

// ---------------------------------------------------------------- comments panel
const panel = $('#commentsPanel');
const commentList = $('#commentList');
const commentForm = $('#commentForm');

function renderComments(comments) {
  $('#commentCount').textContent = `(${comments.length})`;
  commentList.replaceChildren(...(comments.length
    ? comments.map((c) => el('li', {},
      avatar(c.author, true),
      el('div', {}, el('b', {}, `@${c.author}`), ' ', el('span', { class: 'muted small' }, timeAgo(c.createdAt)), el('p', {}, c.text))))
    : [el('li', { class: 'none' }, 'No comments yet. Start the buzz.')]));
  commentList.scrollTop = commentList.scrollHeight;
}

async function openComments(v) {
  state.commentsFor = v.id;
  $('#commentsTitle').textContent = v.title;
  renderComments(v.comments);
  panel.classList.add('open');
  panel.setAttribute('aria-hidden', 'false');
  commentForm.elements.author.value = getPref('rh-name');
  try { renderComments((await api(`/api/videos/${v.id}`)).comments); } catch { /* keep cached list */ }
  commentForm.elements.text.focus();
}
function closeComments() {
  panel.classList.remove('open');
  panel.setAttribute('aria-hidden', 'true');
}
$('#closeComments').addEventListener('click', closeComments);

commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(commentForm));
  if (body.author) setPref('rh-name', body.author);
  try {
    await api(`/api/videos/${state.commentsFor}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    commentForm.elements.text.value = '';
    const v = await api(`/api/videos/${state.commentsFor}`);
    renderComments(v.comments);
    const cached = state.videos.find((x) => x.id === v.id);
    if (cached) cached.comments = v.comments;
    const counter = feed.querySelector(`[data-comment-count="${v.id}"]`);
    if (counter) counter.textContent = fmt(v.comments.length);
  } catch (err) { toast(err.message); }
});

// ---------------------------------------------------------------- upload
const uploadDialog = $('#uploadDialog');
const uploadForm = $('#uploadForm');
const videoInput = $('#videoInput');
const preview = $('#preview');
const dropText = $('#dropText');
const dropZone = $('#dropZone');
const progress = $('#progress');
const uploadError = $('#uploadError');
const uploadBtn = $('#uploadBtn');
const desc = uploadForm.elements.description;

function openUpload() {
  uploadForm.reset();
  preview.hidden = true; preview.removeAttribute('src');
  dropText.hidden = false;
  progress.hidden = true; uploadError.textContent = '';
  $('#descCount').textContent = '0/300';
  $('#creatorInput').value = getPref('rh-name');
  activeVideo()?.pause();
  uploadDialog.showModal();
}
document.querySelectorAll('[data-open-upload]').forEach((b) => b.addEventListener('click', openUpload));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

desc.addEventListener('input', () => { $('#descCount').textContent = `${desc.value.length}/300`; });
['dragenter', 'dragover'].forEach((t) => dropZone.addEventListener(t, () => dropZone.classList.add('drag')));
['dragleave', 'drop'].forEach((t) => dropZone.addEventListener(t, () => dropZone.classList.remove('drag')));

videoInput.addEventListener('change', () => {
  const file = videoInput.files[0];
  if (!file) return;
  preview.src = URL.createObjectURL(file);
  preview.hidden = false; dropText.hidden = true;
  preview.play().catch(() => {});
  const titleInput = uploadForm.elements.title;
  if (!titleInput.value) titleInput.value = file.name.replace(/\.[^.]+$/, '').slice(0, 100);
});

uploadForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = new FormData(uploadForm);
  if (data.get('creator')) setPref('rh-name', data.get('creator'));
  uploadError.textContent = '';
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Posting…';
  progress.hidden = false;
  const bar = progress.firstElementChild;
  bar.style.width = '0';

  // XMLHttpRequest (rather than fetch) so we can show upload progress.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/videos');
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
  const done = () => { uploadBtn.disabled = false; uploadBtn.textContent = 'Post'; };
  xhr.onload = () => {
    done();
    if (xhr.status === 201) {
      uploadDialog.close();
      toast('Posted to the hive 🐝');
      state.query = ''; searchInput.value = ''; $('#filterChip').hidden = true;
      setView('new');
    } else {
      let msg = 'Upload failed';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* not JSON */ }
      uploadError.textContent = msg;
    }
  };
  xhr.onerror = () => { done(); uploadError.textContent = 'Network error. Is the server running?'; };
  xhr.send(data);
});

// ---------------------------------------------------------------- start
// A shared link (?v=<id>) opens straight on that video.
loadFeed({ focusId: new URLSearchParams(location.search).get('v') });

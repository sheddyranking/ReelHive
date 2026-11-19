// ReelHive front end: talks to the REST API with fetch/XHR and builds the feed.
const feed = document.getElementById('feed');
const empty = document.getElementById('empty');
const toastEl = document.getElementById('toast');
const uploadDialog = document.getElementById('uploadDialog');
const uploadForm = document.getElementById('uploadForm');
const commentsDialog = document.getElementById('commentsDialog');

let sort = 'new';
let activeVideoId = null;
const viewed = new Set();

// ---------- helpers ----------
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => toastEl.classList.remove('show'), 2200);
}

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso)) / 1000);
  if (s < 60) return 'just now';
  const units = [[86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [secs, label] of units) if (s >= secs) return `${Math.floor(s / secs)}${label} ago`;
}

function likedSet() {
  try { return new Set(JSON.parse(localStorage.getItem('rh-liked') || '[]')); } catch { return new Set(); }
}
function saveLiked(set) {
  try { localStorage.setItem('rh-liked', JSON.stringify([...set])); } catch { /* storage unavailable */ }
}

async function api(path, options) {
  const res = await fetch(path, options);
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// el('p', {class: 'x'}, 'text') — builds DOM safely (textContent, never innerHTML for user data)
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) node.append(c);
  return node;
}

// ---------- feed ----------
const observer = new IntersectionObserver((entries) => {
  for (const entry of entries) {
    const video = entry.target;
    if (entry.isIntersecting && entry.intersectionRatio > 0.6) {
      video.play().catch(() => {});
      const id = video.dataset.id;
      if (!viewed.has(id)) {
        viewed.add(id);
        api(`/api/videos/${id}/view`, { method: 'POST' }).catch(() => {});
      }
    } else {
      video.pause();
    }
  }
}, { threshold: [0, 0.6, 1] });

function renderCard(v, liked) {
  const video = el('video', { src: v.url, loop: '', muted: '', playsinline: '', preload: 'metadata', 'data-id': v.id });
  video.muted = true;
  const hint = el('span', { class: 'sound-hint' }, 'Tap for sound');
  video.addEventListener('click', () => {
    if (video.muted) { video.muted = false; hint.hidden = true; video.play(); }
    else if (video.paused) video.play();
    else video.pause();
  });
  observer.observe(video);

  const likeCount = el('span', {}, String(v.likes));
  const likeBtn = el('button', { class: liked.has(v.id) ? 'liked' : '', 'aria-label': 'Like' },
    el('span', { class: 'ic' }, '♥'), likeCount);
  likeBtn.addEventListener('click', async () => {
    const set = likedSet();
    if (set.has(v.id)) return toast('You already liked this');
    try {
      const r = await api(`/api/videos/${v.id}/like`, { method: 'POST' });
      likeCount.textContent = r.likes;
      likeBtn.classList.add('liked');
      set.add(v.id); saveLiked(set);
    } catch (e) { toast(e.message); }
  });

  const commentCount = el('span', {}, String(v.comments.length));
  const commentBtn = el('button', { 'aria-label': 'Comments', onclick: () => openComments(v.id, commentCount) },
    el('span', { class: 'ic' }, '💬'), commentCount);

  const delBtn = el('button', { class: 'del', 'aria-label': 'Delete' }, el('span', { class: 'ic' }, '🗑'), 'Delete');
  delBtn.addEventListener('click', async () => {
    if (delBtn.dataset.confirm !== 'yes') {
      delBtn.dataset.confirm = 'yes';
      delBtn.lastChild.textContent = 'Sure?';
      setTimeout(() => { delBtn.dataset.confirm = ''; delBtn.lastChild.textContent = 'Delete'; }, 3000);
      return;
    }
    try {
      await api(`/api/videos/${v.id}`, { method: 'DELETE' });
      toast('Video deleted');
      loadFeed();
    } catch (e) { toast(e.message); }
  });

  return el('article', { class: 'card' },
    video,
    hint,
    el('div', { class: 'shade' }),
    el('div', { class: 'meta' },
      el('p', { class: 'creator' }, `@${v.creator} `, el('span', { class: 'stamp' }, `· ${timeAgo(v.createdAt)} · ${v.views} ${v.views === 1 ? 'view' : 'views'}`)),
      el('p', { class: 'title' }, v.title),
      v.description ? el('p', { class: 'desc' }, v.description) : ''),
    el('div', { class: 'rail' }, likeBtn, commentBtn, delBtn));
}

async function loadFeed() {
  try {
    const videos = await api(`/api/videos?sort=${sort}`);
    const liked = likedSet();
    feed.querySelectorAll('video').forEach((vid) => observer.unobserve(vid));
    feed.replaceChildren(...videos.map((v) => renderCard(v, liked)));
    empty.hidden = videos.length > 0;
    feed.scrollTop = 0;
  } catch (e) {
    toast(`Could not load videos: ${e.message}`);
  }
}

document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
  document.querySelectorAll('.tab').forEach((t) => { t.classList.remove('active'); t.setAttribute('aria-selected', 'false'); });
  tab.classList.add('active'); tab.setAttribute('aria-selected', 'true');
  sort = tab.dataset.sort;
  loadFeed();
}));

// ---------- upload ----------
const videoInput = document.getElementById('videoInput');
const preview = document.getElementById('preview');
const dropText = document.getElementById('dropText');
const progress = document.getElementById('progress');
const uploadError = document.getElementById('uploadError');
const uploadBtn = document.getElementById('uploadBtn');

function openUpload() {
  uploadForm.reset();
  preview.hidden = true; preview.removeAttribute('src');
  dropText.hidden = false;
  progress.hidden = true; uploadError.textContent = '';
  uploadDialog.showModal();
}
document.getElementById('openUpload').addEventListener('click', openUpload);
document.querySelectorAll('[data-open-upload]').forEach((b) => b.addEventListener('click', openUpload));
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));

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
  uploadError.textContent = '';
  uploadBtn.disabled = true;
  progress.hidden = false;
  const bar = progress.firstElementChild;
  bar.style.width = '0';

  // XMLHttpRequest (not fetch) so we can show upload progress.
  const xhr = new XMLHttpRequest();
  xhr.open('POST', '/api/videos');
  xhr.upload.onprogress = (ev) => { if (ev.lengthComputable) bar.style.width = `${(ev.loaded / ev.total) * 100}%`; };
  xhr.onload = () => {
    uploadBtn.disabled = false;
    if (xhr.status === 201) {
      uploadDialog.close();
      toast('Posted to the hive 🐝');
      document.querySelector('.tab[data-sort="new"]').click();
    } else {
      let msg = 'Upload failed';
      try { msg = JSON.parse(xhr.responseText).error || msg; } catch { /* not JSON */ }
      uploadError.textContent = msg;
    }
  };
  xhr.onerror = () => { uploadBtn.disabled = false; uploadError.textContent = 'Network error, is the server running?'; };
  xhr.send(data);
});

// ---------- comments ----------
const commentList = document.getElementById('commentList');
const commentForm = document.getElementById('commentForm');
let activeCountEl = null;

function renderComments(comments) {
  commentList.replaceChildren(...(comments.length
    ? comments.map((c) => el('li', {}, el('b', {}, `@${c.author}`), ' ', el('span', { class: 'stamp' }, timeAgo(c.createdAt)), el('p', {}, c.text)))
    : [el('li', { class: 'none' }, 'No comments yet. Start the buzz.')]));
}

async function openComments(id, countEl) {
  activeVideoId = id; activeCountEl = countEl;
  try {
    const v = await api(`/api/videos/${id}`);
    document.getElementById('commentsTitle').textContent = `Comments on “${v.title}”`;
    renderComments(v.comments);
    commentsDialog.showModal();
  } catch (e) { toast(e.message); }
}

commentForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(new FormData(commentForm));
  try {
    await api(`/api/videos/${activeVideoId}/comments`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    commentForm.elements.text.value = '';
    const v = await api(`/api/videos/${activeVideoId}`);
    renderComments(v.comments);
    activeCountEl.textContent = v.comments.length;
  } catch (err) { toast(err.message); }
});

loadFeed();

// ---- UI LOGIC (REVEAL & PARTICLES) ----
// We run this FIRST to ensure the UI is visible even if analytics fails

// ---- MOBILE HAMBURGER MENU ----
(function () {
  function initHamburger() {
    const hamburger = document.getElementById('hamburger');
    const mobileMenu = document.getElementById('mobileMenu');
    const mobileClose = document.getElementById('mobileClose');
    if (!hamburger || !mobileMenu) return;

    hamburger.addEventListener('click', () => {
      mobileMenu.classList.add('open');
      document.body.style.overflow = 'hidden';
    });

    function closeMenu() {
      mobileMenu.classList.remove('open');
      document.body.style.overflow = '';
    }

    if (mobileClose) mobileClose.addEventListener('click', closeMenu);

    // Close on backdrop click (clicking outside the links)
    mobileMenu.addEventListener('click', (e) => {
      if (e.target === mobileMenu) closeMenu();
    });

    // ESC key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeMenu();
    });

    // Expose globally for onclick="closeMobile()" in HTML
    window.closeMobile = closeMenu;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHamburger);
  } else {
    initHamburger();
  }
})();

// Scroll Reveal & Counter Animation
const reveals = document.querySelectorAll('.reveal');
const countUps = document.querySelectorAll('.count-up');

const revealObserver = new IntersectionObserver((entries) => {
  entries.forEach((entry, i) => {
    if (entry.isIntersecting) {
      setTimeout(() => entry.target.classList.add('visible'), i * 80);
      revealObserver.unobserve(entry.target);
    }
  });
}, { threshold: 0.1 });
reveals.forEach(el => revealObserver.observe(el));

// Reliable Video Engine (Pause/Play)
const videoObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    const video = entry.target;
    if (entry.isIntersecting && video.closest('.tab-pane.active')) {
      video.play().then(() => {
        video.classList.add('loaded');
        video.closest('.skeleton')?.classList.remove('skeleton');
      }).catch(() => {});
    } else {
      video.pause();
    }
  });
}, { threshold: 0.1 });

document.querySelectorAll('video:not(#bg-video)').forEach(v => videoObserver.observe(v));

const counterObserver = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (entry.isIntersecting) {
      const el = entry.target;
      const target = parseFloat(el.getAttribute('data-target'));
      const decimals = parseInt(el.getAttribute('data-decimal') || 0);
      const duration = 2000;
      let startTime = null;

      function step(timestamp) {
        if (!startTime) startTime = timestamp;
        const progress = Math.min((timestamp - startTime) / duration, 1);
        const current = progress * target;
        el.textContent = current.toFixed(decimals);
        if (progress < 1) window.requestAnimationFrame(step);
        else el.textContent = target.toFixed(decimals);
      }
      window.requestAnimationFrame(step);
      counterObserver.unobserve(el);
    }
  });
}, { threshold: 0.5 });
countUps.forEach(el => counterObserver.observe(el));

// Particles
function createParticles() {
  const container = document.getElementById('particles');
  if (!container) return;
  const colors = ['#5865f2', '#9b59f5', '#00c2ff', '#c084fc'];
  for (let i = 0; i < 30; i++) {
    const p = document.createElement('div');
    p.className = 'particle';
    const size = Math.random() * 8 + 4;
    p.style.cssText = `
      width:${size}px; height:${size}px;
      background:${colors[Math.floor(Math.random() * colors.length)]};
      left:${Math.random() * 100}%;
      animation-duration:${Math.random() * 12 + 8}s;
      animation-delay:${Math.random() * 10}s;
      border-radius:${Math.random() > 0.5 ? '4px' : '50%'};
    `;
    container.appendChild(p);
  }
}
createParticles();

// Navbar Scroll
const navbar = document.getElementById('navbar');
if (navbar) {
  window.addEventListener('scroll', () => {
    navbar.classList.toggle('scrolled', window.scrollY > 40);
  });
}

// Mobile Menu
const hamburger = document.getElementById('hamburger');
const mobileMenu = document.getElementById('mobileMenu');
const mobileClose = document.getElementById('mobileClose');
if (hamburger && mobileMenu) hamburger.addEventListener('click', () => mobileMenu.classList.add('open'));
if (mobileClose && mobileMenu) mobileClose.addEventListener('click', () => mobileMenu.classList.remove('open'));
function closeMobile() { mobileMenu?.classList.remove('open'); }

// Smooth Scroll
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const targetId = a.getAttribute('href');
    if (targetId === '#') return;
    const target = document.querySelector(targetId);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});

// ---- ANALYTICS LOGGING ----
// Log delayed page view on load
window.addEventListener('load', () => {
  logEvent('page_view');
});

async function logEvent(type) {
  // Ignore local development views
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log("Analytics: Ignoring local view");
    return;
  }

  try {
    // Upgrade to sessionStorage for improved security & correct session lifetime
    let sessId = sessionStorage.getItem('site_session_id');
    if (!sessId || !/^[a-zA-Z0-9_]{1,50}$/.test(sessId)) {
      sessId = 'sess_' + Math.random().toString(36).substr(2, 9);
      sessionStorage.setItem('site_session_id', sessId);
    }
    
    // Call our Analytics API
    await fetch('/api/analytics', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event_type: type,
        path: window.location.pathname,
        session_id: sessId,
        user_agent: navigator.userAgent
      })
    });
  } catch (err) { console.error('Analytics log error:', err); }
}

// ---- HEARTBEAT SYSTEM ----
// Sends a signal every 30 seconds to keep the user "Active" on the dashboard
setInterval(() => {
  logEvent('heartbeat');
}, 30000);

// ---- DOWNLOADS & THANK YOU ----
const heroMainContent = document.getElementById('hero-main-content');
const heroThankYou = document.getElementById('hero-thank-you');
const confettiContainer = document.getElementById('confetti-container');

function triggerConfetti() {
  if (!confettiContainer) return;
  const colors = ['#3b82f6', '#8b5cf6', '#ec4899', '#f2d74e', '#22c55e'];
  for (let i = 0; i < 80; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.left = Math.random() * 100 + '%';
    c.style.backgroundColor = colors[Math.floor(Math.random() * colors.length)];
    c.style.width = Math.random() * 8 + 6 + 'px';
    c.style.height = Math.random() * 12 + 6 + 'px';
    c.style.animationDelay = Math.random() * 0.5 + 's';
    confettiContainer.appendChild(c);
    setTimeout(() => c.remove(), 4000);
  }
}

// Download Handling with Mobile Warning
const downloadWarningModal = document.getElementById('downloadWarningModal');
const confirmDownloadBtn = document.getElementById('confirmDownload');
const cancelDownloadBtn = document.getElementById('cancelDownload');
const warningModalClose = document.getElementById('warningModalClose');
let pendingDownloadUrl = null;

document.querySelectorAll('a[href*=".exe"], .nav-btn-dl, .btn-primary[href*="r2.dev"]').forEach(btn => {
  btn.addEventListener('click', (e) => {
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile && downloadWarningModal) {
      e.preventDefault();
      pendingDownloadUrl = btn.href;
      downloadWarningModal.classList.add('open');
      return;
    }

    executeDownload(btn.href);
  });
});

function executeDownload(url) {
  logEvent('download_click');
  
  // Start the actual download if it's a direct link
  if (url) {
    // Validate download URL to ensure it is from trusted domains
    try {
      const parsedUrl = new URL(url, window.location.origin);
      const trustedDomains = [
        window.location.hostname,
        'pub-ea550d73efa44ce9a10a6fa1948cf626.r2.dev',
        'msgncyczxaldboqqyjhw.supabase.co'  // Supabase community wallpaper storage
      ];
      if (!trustedDomains.includes(parsedUrl.hostname)) {
        console.warn("Blocked untrusted download URL:", url);
        return;
      }
    } catch (e) {
      console.error("Invalid download URL:", url);
      return;
    }

    const a = document.createElement('a');
    a.href = url;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  }

  if (heroThankYou) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      heroThankYou.style.display = 'flex';
      heroThankYou.style.opacity = '0';
      setTimeout(() => {
        heroThankYou.style.opacity = '1';
        triggerConfetti();
      }, 50);
    }, 100);
  }
}

if (downloadWarningModal) {
  const closeWarning = () => downloadWarningModal.classList.remove('open');
  warningModalClose?.addEventListener('click', closeWarning);
  cancelDownloadBtn?.addEventListener('click', closeWarning);
  confirmDownloadBtn?.addEventListener('click', () => {
    closeWarning();
    if (pendingDownloadUrl) executeDownload(pendingDownloadUrl);
  });
  downloadWarningModal.addEventListener('click', (e) => { if (e.target === downloadWarningModal) closeWarning(); });
}


// ---- SUPABASE CLIENT INITIALIZATION & LIVE GALLERY ----
// SECURITY NOTE: The anon key below is a PUBLIC key designed to be client-side.
// It is safe to expose ONLY when Supabase Row Level Security (RLS) policies are
// correctly configured. See SupabaseSetup.sql for the required RLS policies.
const supabaseUrl = 'https://msgncyczxaldboqqyjhw.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZ25jeWN6eGFsZGJvcXF5amh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDI2ODksImV4cCI6MjA5MzMxODY4OX0.xccy6mitXQJ5eckmcOTxRn6O5iy1Mlbd-wY5lxOzPHI';
let supabaseClient = null;
let communityWallpapers = [];

if (typeof supabase !== 'undefined') {
  supabaseClient = supabase.createClient(supabaseUrl, supabaseKey);
  window.supabaseClient = supabaseClient;
}

// Video Lightbox Logic (Original)
const videoLightbox = document.getElementById('videoLightbox');
const lightboxVideo = document.getElementById('lightboxVideo');
const lightboxCloseBtn = document.getElementById('lightboxClose');
if (videoLightbox && lightboxCloseBtn) {
  const closeVideoLightbox = () => {
    videoLightbox.classList.remove('open');
    if (lightboxVideo) {
      lightboxVideo.pause();
      lightboxVideo.src = "";
    }
  };
  lightboxCloseBtn.addEventListener('click', closeVideoLightbox);
  videoLightbox.addEventListener('click', (e) => { if (e.target === videoLightbox) closeVideoLightbox(); });
}

// Image Lightbox Logic (Custom)
const imageLightbox = document.getElementById('imageLightbox');
const lightboxImage = document.getElementById('lightboxImage');
const imageLightboxCloseBtn = document.getElementById('imageLightboxClose');
if (imageLightbox && imageLightboxCloseBtn) {
  const closeImageLightbox = () => {
    imageLightbox.classList.remove('open');
    if (lightboxImage) {
      lightboxImage.src = "";
      lightboxImage.classList.remove('zoomed');
      lightboxImage.style.transform = 'none';
      lightboxImage.style.transformOrigin = 'center center';
    }
  };
  imageLightboxCloseBtn.addEventListener('click', closeImageLightbox);
  imageLightbox.addEventListener('click', (e) => { if (e.target === imageLightbox) closeImageLightbox(); });

  if (lightboxImage) {
    const zoomImage = (e) => {
      const rect = lightboxImage.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 100;
      const y = ((e.clientY - rect.top) / rect.height) * 100;
      lightboxImage.style.transformOrigin = `${x}% ${y}%`;
      lightboxImage.style.transform = 'scale(2.5)';
    };

    lightboxImage.addEventListener('click', (e) => {
      e.stopPropagation(); // prevent closing the lightbox when clicking the image to zoom
      lightboxImage.classList.toggle('zoomed');
      if (lightboxImage.classList.contains('zoomed')) {
        zoomImage(e);
      } else {
        lightboxImage.style.transform = 'none';
        lightboxImage.style.transformOrigin = 'center center';
      }
    });

    lightboxImage.addEventListener('mousemove', (e) => {
      if (lightboxImage.classList.contains('zoomed')) {
        zoomImage(e);
      }
    });
  }
}

async function fetchCommunityWallpapers() {
  const loadingEl = document.getElementById('gallery-loading');
  const emptyEl = document.getElementById('gallery-empty');
  const gridEl = document.getElementById('gallery-grid');
  
  if (loadingEl) loadingEl.style.display = 'flex';
  if (emptyEl) emptyEl.style.display = 'none';
  if (gridEl) gridEl.style.display = 'none';
  
  if (typeof db === 'undefined' || !db) {
    console.error("Firebase Firestore is not initialized.");
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  
  try {
    const snapshot = await db.collection('community_wallpapers')
      .orderBy('created_at', 'desc')
      .get();
      
    communityWallpapers = [];
    snapshot.forEach(doc => {
      communityWallpapers.push({ id: doc.id, ...doc.data() });
    });
    
    filterGallery();
  } catch (err) {
    console.error("Error fetching community wallpapers:", err);
    if (loadingEl) loadingEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
  }
}

let activeFormatFilter = 'video';

function setFormatFilter(type) {
  activeFormatFilter = type;
  
  // Update active state on pill buttons
  const buttons = document.querySelectorAll('.format-pill-selector .pill-btn');
  buttons.forEach(btn => {
    if (btn.getAttribute('data-type') === type) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });
  
  filterGallery();
}

async function getFileSize(url) {
  try {
    const response = await fetch(url, { method: 'HEAD' });
    const size = response.headers.get('content-length');
    if (size) {
      const bytes = parseInt(size, 10);
      if (bytes > 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
      if (bytes > 1024) return (bytes / 1024).toFixed(0) + ' KB';
      return bytes + ' Bytes';
    }
  } catch (e) {
    console.error("Failed to fetch file size:", e);
  }
  return 'Unknown';
}

function getImageResolution(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve(`${img.naturalWidth} × ${img.naturalHeight}`);
    };
    img.onerror = () => {
      resolve('4K (3840 × 2160)'); // default fallback
    };
    img.src = url;
  });
}

function parseResolutionFromTitle(title) {
  const match = title.match(/(\d{3,5})\s*[xX]\s*(\d{3,5})/);
  if (match) {
    return `${match[1]} × ${match[2]}`;
  }
  return null;
}

function renderGallery(items) {
  const loadingEl = document.getElementById('gallery-loading');
  const emptyEl = document.getElementById('gallery-empty');
  const gridEl = document.getElementById('gallery-grid');
  
  if (loadingEl) loadingEl.style.display = 'none';
  
  if (items.length === 0) {
    if (gridEl) gridEl.style.display = 'none';
    if (emptyEl) emptyEl.style.display = 'block';
    return;
  }
  
  if (emptyEl) emptyEl.style.display = 'none';
  if (gridEl) {
    gridEl.innerHTML = '';
    gridEl.style.display = 'grid';

    const likedWallpapers = JSON.parse(localStorage.getItem('liked_wallpapers') || '[]');
    
    items.forEach(wp => {
      const card = document.createElement('div');
      const isVideo = wp.is_video === true || wp.is_video === 'true';

      card.className = isVideo ? 'gallery-card reveal visible' : 'gallery-card image-card reveal visible';

      // HIGH-06 FIX: Escape ALL user-supplied database values before injecting into innerHTML
      const safeId       = escapeHtml(wp.id       || '');
      const safeTitle    = escapeHtml(wp.title    || 'Untitled');
      const safeCreator  = escapeHtml(wp.creator  || 'Anonymous');
      const safeDesc     = escapeHtml(wp.description || 'No description provided.');
      const safeCategory = escapeHtml(wp.category || 'General');
      const safeUserId   = escapeHtml(wp.user_id  || '');
      // URLs: escape for attribute context (single-quoted attrs in onclick are escaped by escapeHtml)
      const safeFileUrl  = escapeHtml(wp.file_url      || '');
      const safeThumbUrl = escapeHtml(wp.thumbnail_url || '');

      // Tags: escape each tag individually
      const tagsHtml = wp.tags
        ? wp.tags.split(',').map(t => `<span class="gallery-tag">${escapeHtml(t.trim())}</span>`).join('')
        : '<span class="gallery-tag">no tags</span>';

      const placeholderSvg = 'data:image/svg+xml,%3Csvg xmlns%3D%22http%3A//www.w3.org/2000/svg%22 width%3D%22100%22 height%3D%22100%22%3E%3C/svg%3E';
      const thumbSrc = safeThumbUrl || placeholderSvg;
      
      const isLiked = likedWallpapers.includes(wp.id);
      const likesCount = wp.likes !== undefined ? wp.likes : (isLiked ? 1 : 0);
      const likeBtnHtml = `
        <button class="gallery-like-btn ${isLiked ? 'liked' : ''}" onclick="toggleLike('${safeId}', event)" style="position: absolute; top: 12px; right: 12px; z-index: 10; display: flex; align-items: center; gap: 6px; padding: 6px 12px; border-radius: 12px; background: rgba(13,13,15,0.75); border: 1px solid rgba(255,255,255,0.08); color: #fff; cursor: pointer; transition: all 0.25s ease; font-size: 0.8rem; font-family: 'Inter', sans-serif; backdrop-filter: blur(8px);">
          <span class="heart-icon" style="color: ${isLiked ? '#ff5577' : 'rgba(255,255,255,0.6)'}; font-size: 0.95rem; transition: color 0.2s;">${isLiked ? '♥' : '♡'}</span>
          <span class="like-count" style="font-weight: 600;">${likesCount}</span>
        </button>
      `;

      if (isVideo) {
        card.innerHTML = `
          <div class="gallery-thumb-container">
            <img src="${thumbSrc}" alt="${safeTitle}">
            ${likeBtnHtml}
            <button class="gallery-play-btn" onclick="openLightbox('${safeFileUrl}', '${safeTitle}', '${safeCreator}', true, '${safeThumbUrl}')">
              <svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>
            </button>
            <span class="category-badge">${safeCategory}</span>
          </div>
          <div class="gallery-card-info">
            <div class="gallery-card-header">
              <h4 class="gallery-title" title="${safeTitle}">${safeTitle}</h4>
            </div>
            <span class="gallery-creator">By ${safeCreator}</span>
            <p class="gallery-desc" title="${safeDesc}">${safeDesc}</p>
            <div class="gallery-tags-wrapper">${tagsHtml}</div>
          </div>
          <div class="gallery-card-footer">
            <span>📹 Video</span>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
              <button class="gallery-dl-btn" style="background: rgba(239,68,68,0.05); border-color: rgba(239,68,68,0.15); color: #f87171;" onclick="openReportModal('${safeId}', '${safeUserId}', '${safeTitle}')">Report</button>
              <button class="gallery-dl-btn" onclick="addToBasicWallpapers('${safeFileUrl}', '${safeTitle}', true)" style="background: rgba(168,85,247,0.1); border-color: rgba(168,85,247,0.25); color: #c084fc;">Add to App</button>
              <button class="gallery-dl-btn" onclick="downloadAsset('${safeFileUrl}')">Download</button>
            </div>
          </div>
        `;
      } else {
        card.innerHTML = `
          <div class="gallery-thumb-container">
            <img src="${thumbSrc}" alt="${safeTitle}">
            ${likeBtnHtml}
            <button class="gallery-play-btn" title="Zoom Image" onclick="openLightbox('${safeFileUrl}', '${safeTitle}', '${safeCreator}', false, '${safeThumbUrl || safeFileUrl}')">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line><line x1="11" y1="8" x2="11" y2="14"></line><line x1="8" y1="11" x2="14" y2="11"></line></svg>
            </button>
          </div>
          <div class="gallery-card-info">
            <div class="gallery-card-header">
              <h4 class="gallery-title" title="${safeTitle}">${safeTitle}</h4>
            </div>
            <span class="gallery-creator">By ${safeCreator}</span>
            <div class="gallery-card-meta-row">
              <span id="card-res-${safeId}">📐 Resolution: --</span>
              <span id="card-size-${safeId}">📦 Size: --</span>
            </div>
            <p class="gallery-desc" title="${safeDesc}">${safeDesc}</p>
            <div class="gallery-tags-wrapper">${tagsHtml}</div>
          </div>
          <div class="gallery-card-footer">
            <span>🖼️ Image</span>
            <div style="display: flex; gap: 8px; flex-wrap: wrap; justify-content: flex-end;">
              <button class="gallery-dl-btn" style="background: rgba(239,68,68,0.05); border-color: rgba(239,68,68,0.15); color: #f87171;" onclick="openReportModal('${safeId}', '${safeUserId}', '${safeTitle}')">Report</button>
              <button class="gallery-dl-btn" onclick="addToBasicWallpapers('${safeFileUrl}', '${safeTitle}', false)" style="background: rgba(168,85,247,0.1); border-color: rgba(168,85,247,0.25); color: #c084fc;">Add to App</button>
              <button class="gallery-dl-btn" onclick="downloadAsset('${safeFileUrl}')">Download</button>
            </div>
          </div>
        `;
      }
      
      gridEl.appendChild(card);
 
      if (!isVideo) {
        // Fetch size asynchronously — use escaped ID to match the element above
        getFileSize(wp.file_url).then(size => {
          const el = document.getElementById(`card-size-${escapeHtml(wp.id)}`);
          // escapeHtml the dynamic size value before setting innerHTML
          if (el) el.innerHTML = `📦 <strong>Size:</strong> ${escapeHtml(size)}`;
        });

        // Fetch/Parse resolution
        const parsedRes = parseResolutionFromTitle(wp.title);
        if (parsedRes) {
          const el = document.getElementById(`card-res-${escapeHtml(wp.id)}`);
          if (el) el.innerHTML = `📐 <strong>Res:</strong> ${escapeHtml(parsedRes)}`;
        } else {
          getImageResolution(wp.file_url).then(resolution => {
            const el = document.getElementById(`card-res-${escapeHtml(wp.id)}`);
            if (el) el.innerHTML = `📐 <strong>Res:</strong> ${escapeHtml(resolution)}`;
          });
        }
      }
    });
  }
}
 
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
 
function filterGallery() {
  const query = document.getElementById('gallery-search')?.value.toLowerCase().trim() || '';
  const type = activeFormatFilter;
  const category = document.getElementById('gallery-category-filter')?.value || 'all';
  const sort = document.getElementById('gallery-sort-filter')?.value || 'newest';
  
  let filtered = communityWallpapers.filter(wp => {
    const titleMatch = wp.title && wp.title.toLowerCase().includes(query);
    const creatorMatch = wp.creator && wp.creator.toLowerCase().includes(query);
    const descMatch = wp.description && wp.description.toLowerCase().includes(query);
    const tagMatch = wp.tags && wp.tags.toLowerCase().includes(query);
    
    const matchesText = !query || (titleMatch || creatorMatch || descMatch || tagMatch);
    
    let matchesType = true;
    const isVideo = wp.is_video === true || wp.is_video === 'true';
    if (type === 'video') matchesType = isVideo;
    if (type === 'image') matchesType = !isVideo;
    
    let matchesCategory = true;
    if (category !== 'all') {
      matchesCategory = (wp.category || 'General') === category;
    }
    
    return matchesText && matchesType && matchesCategory;
  });

  const likedWallpapers = JSON.parse(localStorage.getItem('liked_wallpapers') || '[]');
  const getLikes = (wp) => wp.likes !== undefined ? wp.likes : (likedWallpapers.includes(wp.id) ? 1 : 0);

  if (sort === 'most-liked') {
    filtered.sort((a, b) => getLikes(b) - getLikes(a));
  } else {
    filtered.sort((a, b) => {
      const da = a.created_at ? new Date(a.created_at) : 0;
      const db = b.created_at ? new Date(b.created_at) : 0;
      return db - da;
    });
  }
  
  renderGallery(filtered);
}
 
function extractVibrantColor(imgSrc, callback) {
  if (!imgSrc) {
    callback(null, null);
    return;
  }
  const img = new Image();
  img.crossOrigin = "Anonymous";
  
  // MED-13/LOW-20 FIX: Use our own /api/image-proxy instead of third-party corsproxy.io.
  // This prevents leaking wallpaper URLs to an external service.
  if (imgSrc.startsWith('http')) {
    img.src = '/api/image-proxy?url=' + encodeURIComponent(imgSrc);
  } else {
    img.src = imgSrc;
  }
  
  img.onload = function() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = img.width;
    canvas.height = img.height;
    ctx.drawImage(img, 0, 0);
    try {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let r = 0, g = 0, b = 0, count = 0;
      for (let i = 0; i < data.length; i += 16) {
        let pr = data[i], pg = data[i+1], pb = data[i+2];
        let max = Math.max(pr, pg, pb);
        let min = Math.min(pr, pg, pb);
        let saturation = (max === 0) ? 0 : (max - min) / max;
        if (saturation > 0.15) { 
           r += pr; g += pg; b += pb; count++;
        }
      }
      if (count === 0) { 
        for (let i = 0; i < data.length; i += 16) {
           r += data[i]; g += data[i+1]; b += data[i+2]; count++;
        }
      }
      if (count > 0) {
        r = Math.floor(r / count);
        g = Math.floor(g / count);
        b = Math.floor(b / count);
        // Boost brightness slightly
        r = Math.min(255, r + 20);
        g = Math.min(255, g + 20);
        b = Math.min(255, b + 20);
        callback(`rgb(${r}, ${g}, ${b})`, `rgba(${r}, ${g}, ${b}, 0.6)`);
      } else {
        callback(null, null);
      }
    } catch(e) {
      console.warn("Color extraction failed:", e);
      callback(null, null);
    }
  };
  img.onerror = (e) => {
    console.warn("CORS Proxy Image Load failed:", e);
    callback(null, null);
  };
}

function openLightbox(url, title, creator, isVideo, thumbUrl) {
  const applyColor = (rgb, rgba) => {
    const updateElements = (wrapperId, contentSelector, btnId) => {
      const wrapper = document.getElementById(wrapperId);
      const content = wrapper?.querySelector(contentSelector);
      const btn = document.getElementById(btnId);
      
      if (content && rgb) {
        content.style.boxShadow = `0 0 60px ${rgba}`;
        // Apply a subtle background to the wrapper to make it beautiful like the user's screenshot
        wrapper.style.backgroundColor = rgba.replace('0.6', '0.2');
        wrapper.style.padding = '40px';
        wrapper.style.borderRadius = '24px';
      } else if (content) {
        content.style.boxShadow = `0 0 50px rgba(155, 89, 245, 0.5)`;
        wrapper.style.backgroundColor = 'transparent';
        wrapper.style.padding = '0';
      }
      
      if (btn && rgb) {
        btn.style.background = rgb;
        btn.style.color = '#fff';
        btn.style.boxShadow = `0 8px 25px ${rgba}`;
        // Ensure text is readable if color is too light
        const luminance = 0.299*parseInt(rgb.split(',')[0].replace(/\D/g,'')) + 0.587*parseInt(rgb.split(',')[1].replace(/\D/g,'')) + 0.114*parseInt(rgb.split(',')[2].replace(/\D/g,''));
        if (luminance > 160) btn.style.color = '#000';
      } else if (btn) {
        btn.style.background = 'var(--gradient-primary)';
        btn.style.color = '#000';
        btn.style.boxShadow = '0 4px 25px rgba(0, 194, 255, 0.4)';
      }
    };

    if (isVideo) {
      updateElements('videoLightboxWrapper', '.lightbox-content', 'videoLightboxDownloadBtn');
    } else {
      updateElements('imageLightboxWrapper', '.lightbox-content', 'imageLightboxDownloadBtn');
    }
  };

  if (thumbUrl) {
    extractVibrantColor(thumbUrl, (rgb, rgba) => applyColor(rgb, rgba));
  } else {
    applyColor(null, null);
  }

  if (isVideo) {
    const videoLightbox = document.getElementById('videoLightbox');
    const lightboxVideo = document.getElementById('lightboxVideo');
    const lightboxTitle = document.getElementById('lightboxTitle');
    const lightboxAuthor = document.getElementById('lightboxAuthor');
    const videoLightboxDownloadBtn = document.getElementById('videoLightboxDownloadBtn');
    
    if (videoLightbox) {
      if (lightboxTitle) lightboxTitle.textContent = title;
      if (lightboxAuthor) lightboxAuthor.textContent = `By ${creator || 'Anonymous'}`;
      if (lightboxVideo) {
        lightboxVideo.src = url;
        lightboxVideo.play().catch(() => {});
      }
      if (videoLightboxDownloadBtn) {
        videoLightboxDownloadBtn.onclick = () => downloadAsset(url);
      }
      videoLightbox.classList.add('open');
      logEvent('video_zoom_click');
    }
  } else {
    const imageLightbox = document.getElementById('imageLightbox');
    const lightboxImage = document.getElementById('lightboxImage');
    const imageLightboxDownloadBtn = document.getElementById('imageLightboxDownloadBtn');
    
    if (imageLightbox) {
      if (lightboxImage) {
        lightboxImage.src = url;
        lightboxImage.classList.remove('zoomed');
        lightboxImage.style.transform = 'none';
        lightboxImage.style.transformOrigin = 'center center';
      }
      
      if (imageLightboxDownloadBtn) {
        imageLightboxDownloadBtn.onclick = () => downloadAsset(url);
      }
      
      imageLightbox.classList.add('open');
      logEvent('image_zoom_click');
    }
  }
}
 
function downloadAsset(url) {
  logEvent('community_wallpaper_download');
  
  // Use the local server download proxy to bypass CORS and force direct file download
  window.location.href = `/api/download?url=${encodeURIComponent(url)}`;
}
 
function addToBasicWallpapers(url, title = "Online Wallpaper", isVideo = true) {
  logEvent('community_wallpaper_add_to_app');
  
  const customProtocolUrl = `basicwallpaper://add?url=${encodeURIComponent(btoa(url))}&title=${encodeURIComponent(title)}&is_video=${isVideo}`;
  const downloadUrl = "https://pub-ea550d73efa44ce9a10a6fa1948cf626.r2.dev/BasicWallpaperSetup.exe";
  
  let timeout;
  const preventRedirect = () => {
    clearTimeout(timeout);
    window.removeEventListener('blur', preventRedirect);
  };
  
  // Listen for browser tab blur, meaning the custom protocol handler dialog opened or app launched
  window.addEventListener('blur', preventRedirect);
  
  // Attempt to open the custom deep link protocol
  window.location.href = customProtocolUrl;
  
  // If the browser does not lose focus within 2.5s, trigger the setup file download fallback
  timeout = setTimeout(() => {
    window.removeEventListener('blur', preventRedirect);
    if (document.hasFocus()) {
      alert("Basic Wallpaper is not running or installed. Downloading the installation software...");
      window.location.href = downloadUrl;
    }
  }, 2500);
}

async function toggleLike(wallpaperId, event) {
  if (event) event.stopPropagation();

  let likedWallpapers = JSON.parse(localStorage.getItem('liked_wallpapers') || '[]');
  const index = likedWallpapers.indexOf(wallpaperId);
  const isLiked = index !== -1;

  if (isLiked) {
    likedWallpapers.splice(index, 1);
  } else {
    likedWallpapers.push(wallpaperId);
  }
  localStorage.setItem('liked_wallpapers', JSON.stringify(likedWallpapers));

  // Find in local array and update UI count immediately
  const wp = communityWallpapers.find(w => w.id === wallpaperId);
  if (wp) {
    if (wp.likes === undefined) {
      wp.likes = isLiked ? 1 : 0;
    }
    wp.likes = Math.max(0, wp.likes + (isLiked ? -1 : 1));
  }

  // Re-render gallery (or filter it) so count and heart changes
  filterGallery();

  // Send update to Supabase RPC
  if (typeof supabaseClient !== 'undefined' && supabaseClient) {
    try {
      await supabaseClient.rpc('toggle_wallpaper_like', {
        wallpaper_id: wallpaperId,
        is_like: !isLiked
      });

      // Also update user_settings table if logged in
      if (window.firebaseAuth && window.firebaseAuth.currentUser) {
        const email = window.firebaseAuth.currentUser.email;
        const { data, error } = await supabaseClient
          .from('user_settings')
          .select('settings_json')
          .eq('email', email)
          .maybeSingle();

        let settings = {};
        if (!error && data && data.settings_json) {
          try { settings = JSON.parse(data.settings_json); } catch (e) {}
        }
        settings.LikedWallpaperIds = likedWallpapers;

        await supabaseClient
          .from('user_settings')
          .upsert({
            email: email,
            settings_json: JSON.stringify(settings),
            updated_at: new Date().toISOString()
          });
      }
    } catch (err) {
      console.error("Supabase RPC like error:", err);
    }
  }
}
window.toggleLike = toggleLike;

// Trigger initial fetch on load safely
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', fetchCommunityWallpapers);
} else {
  fetchCommunityWallpapers();
}

// Modal Logic (keeping for community warning if needed elsewhere)
const communityModal = document.getElementById('communityModal');
const modalCloseBtn = document.getElementById('modalClose');
const modalCancelBtn = document.getElementById('modalCancel');

if (communityModal) {
  const closeModal = () => communityModal.classList.remove('open');
  modalCloseBtn?.addEventListener('click', closeModal);
  modalCancelBtn?.addEventListener('click', closeModal);
  communityModal.addEventListener('click', (e) => { if (e.target === communityModal) closeModal(); });
}

// MAGIC LENS & LIGHTBOX LOGIC
const lens = document.getElementById('cursor-preview');
const lensVideo = document.getElementById('cursor-video');
const stepCards = document.querySelectorAll('.step-card');
const cinemaLightbox = document.getElementById('video-lightbox');
const cinemaLightboxVideo = document.getElementById('lightbox-video');
const lightboxClose = document.querySelector('.lightbox-close');

const stepVideos = {
  '01': 'https://pub-ea550d73efa44ce9a10a6fa1948cf626.r2.dev/tutorials/Installing.mp4',
  '02': 'https://pub-ea550d73efa44ce9a10a6fa1948cf626.r2.dev/tutorials/Discover%20Wallpapers.mp4',
  '03': 'https://pub-ea550d73efa44ce9a10a6fa1948cf626.r2.dev/tutorials/Red%20girl%20animated.mp4'
};

document.addEventListener('mousemove', (e) => {
  if (lens && lens.classList.contains('active')) {
    lens.style.left = e.clientX + 'px';
    lens.style.top = e.clientY + 'px';
  }
});

stepCards.forEach(card => {
  card.addEventListener('mouseenter', () => {
    const stepNum = card.querySelector('.step-num').textContent;
    if (stepVideos[stepNum]) {
      lensVideo.src = stepVideos[stepNum];
      lensVideo.play().catch(() => {});
      lens.classList.add('active');
    }
  });

  card.addEventListener('mouseleave', () => {
    lens.classList.remove('active');
    lensVideo.pause();
    lensVideo.src = '';
  });

  // Cinema Mode Double Click
  card.addEventListener('dblclick', () => {
    const stepNum = card.querySelector('.step-num').textContent;
    if (stepVideos[stepNum]) {
      cinemaLightboxVideo.src = stepVideos[stepNum];
      cinemaLightbox.classList.add('open');
      cinemaLightboxVideo.play();
    }
  });
});

const closeCinema = () => {
  cinemaLightbox.classList.remove('open');
  cinemaLightboxVideo.pause();
  cinemaLightboxVideo.src = '';
};

lightboxClose?.addEventListener('click', closeCinema);
cinemaLightbox?.addEventListener('click', (e) => {
  if (e.target === cinemaLightbox) closeCinema();
});
// GLOBAL BACKGROUND SCROLL LOGIC
const glow1 = document.querySelector('.glow-1');
const glow2 = document.querySelector('.glow-2');

window.addEventListener('scroll', () => {
  const scrolled = window.scrollY;
  if (glow1) {
    glow1.style.transform = `translate(${scrolled * 0.1}px, ${scrolled * 0.15}px)`;
  }
  if (glow2) {
    glow2.style.transform = `translate(${scrolled * -0.1}px, ${scrolled * -0.1}px)`;
  }
});

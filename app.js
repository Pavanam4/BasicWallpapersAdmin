// Supabase to Firebase Firestore/Storage Compatibility Wrapper
class SupabaseToFirestoreCompat {
  constructor(db, storage) {
    this.db = db;
    this.storage = storage;
  }
  
  from(tableName) {
    return new FirestoreQueryBuilder(this.db, this.storage, tableName);
  }
  
  get auth() {
    return {
      signUp: async (credentials) => {
        try {
          const userCredential = await firebase.auth().createUserWithEmailAndPassword(credentials.email, credentials.password);
          return { data: { user: userCredential.user }, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      },
      signIn: async (credentials) => {
        try {
          const userCredential = await firebase.auth().signInWithEmailAndPassword(credentials.email, credentials.password);
          return { data: { user: userCredential.user }, error: null };
        } catch (e) {
          return { data: null, error: e };
        }
      }
    };
  }

  get storage() {
    return {
      from: (bucketName) => {
        return {
          upload: async (fileName, fileData) => {
            try {
              const url = `${settings.supabaseUrl}/storage/v1/object/${bucketName}/${fileName}`;
              const mimeType = fileName.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg';
              const response = await fetch(url, {
                method: 'POST',
                headers: {
                  'apikey': settings.supabaseKey,
                  'Authorization': `Bearer ${settings.supabaseKey}`,
                  'Content-Type': mimeType
                },
                body: fileData
              });
              if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText);
              }
              const data = await response.json();
              return { data, error: null };
            } catch (e) {
              return { data: null, error: e };
            }
          },
          getPublicUrl: (fileName) => {
            const publicUrl = `${settings.supabaseUrl}/storage/v1/object/public/${bucketName}/${fileName}`;
            return { data: { publicUrl } };
          },
          remove: async (fileNames) => {
            try {
              const url = `${settings.supabaseUrl}/storage/v1/object/${bucketName}`;
              const response = await fetch(url, {
                method: 'DELETE',
                headers: {
                  'apikey': settings.supabaseKey,
                  'Authorization': `Bearer ${settings.supabaseKey}`,
                  'Content-Type': 'application/json'
                },
                body: JSON.stringify({ prefixes: fileNames })
              });
              if (!response.ok) {
                const errText = await response.text();
                throw new Error(errText);
              }
              const data = await response.json();
              return { data, error: null };
            } catch (e) {
              return { data: null, error: e };
            }
          }
        };
      }
    };
  }
}

class FirestoreQueryBuilder {
  constructor(db, storage, tableName) {
    this.db = db;
    this.storage = storage;
    this.tableName = tableName;
    this.query = db.collection(tableName);
    this.filters = [];
    this.orderField = null;
    this.orderAscending = true;
    this.limitVal = null;
  }

  select(fields = '*') {
    return this;
  }

  eq(field, value) {
    this.query = this.query.where(field, '==', value);
    return this;
  }

  neq(field, value) {
    this.query = this.query.where(field, '!=', value);
    return this;
  }

  limit(val) {
    this.limitVal = val;
    return this;
  }

  order(field, options = {}) {
    this.orderField = field;
    this.orderAscending = options.ascending !== false;
    return this;
  }

  async get() {
    try {
      let q = this.query;
      if (this.orderField) {
        q = q.orderBy(this.orderField, this.orderAscending ? 'asc' : 'desc');
      }
      if (this.limitVal !== null) {
        q = q.limit(this.limitVal);
      }
      const snapshot = await q.get();
      const data = [];
      snapshot.forEach(doc => {
        data.push({ id: doc.id, ...doc.data() });
      });
      return { data, error: null };
    } catch (e) {
      console.error("Firestore get error:", e);
      return { data: null, error: e };
    }
  }

  async insert(rows) {
    try {
      const dataList = Array.isArray(rows) ? rows : [rows];
      const inserted = [];
      for (const row of dataList) {
        const docId = row.id || Math.random().toString(36).substring(2, 11) + '_' + Date.now();
        const dataToSave = { ...row };
        delete dataToSave.id;
        if (!dataToSave.created_at) {
          dataToSave.created_at = new Date().toISOString();
        }
        await this.db.collection(this.tableName).doc(docId).set(dataToSave);
        inserted.push({ id: docId, ...dataToSave });
      }
      return { data: inserted, error: null };
    } catch (e) {
      console.error("Firestore insert error:", e);
      return { data: null, error: e };
    }
  }

  async update(row) {
    try {
      const snapshot = await this.query.get();
      const promises = [];
      snapshot.forEach(doc => {
        promises.push(doc.ref.update(row));
      });
      await Promise.all(promises);
      return { data: {}, error: null };
    } catch (e) {
      console.error("Firestore update error:", e);
      return { data: null, error: e };
    }
  }

  async delete() {
    try {
      const snapshot = await this.query.get();
      const promises = [];
      snapshot.forEach(doc => {
        promises.push(doc.ref.delete());
      });
      await Promise.all(promises);
      return { data: {}, error: null };
    } catch (e) {
      console.error("Firestore delete error:", e);
      return { data: null, error: e };
    }
  }
}

// App Constants & State
let activeTab = 'upload';
let uploadDestination = 'r2'; // 'supabase' or 'r2'
let uploadQueue = [];
let isUploading = false;
let communityWallpapers = [];

// Cloudflare Worker URL — all R2 uploads go through this
const WORKER_URL = 'https://solitary-sound-f6ff.pavanam926.workers.dev';

// Default credentials based on WPF app configuration
const DEFAULT_SETTINGS = {
  supabaseUrl: 'https://msgncyczxaldboqqyjhw.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zZ25jeWN6eGFsZGJvcXF5amh3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc3NDI2ODksImV4cCI6MjA5MzMxODY4OX0.xccy6mitXQJ5eckmcOTxRn6O5iy1Mlbd-wY5lxOzPHI',
  supabaseWallpapersBucket: 'wallpapers',
  supabaseThumbnailsBucket: 'thumbnails',
  r2AccountId: '4ebc2f5c259cf67d98468f749a56176c',
  r2AccessKey: '87fb6a552638418a67f1c126ba0379c8',
  r2SecretKey: 'b75a1f08ad503ac809a40560b154d7b058190ba410cd58a061867573946cd066',
  r2Bucket: 'wallpaper-videos-new',   // ← actual bucket with the videos
  r2Region: 'auto',
  r2CustomDomain: 'https://pub-7650175b10aa4aa8916c6a32f15f32ff.r2.dev',
  geminiApiKey: ''
};


let settings = { ...DEFAULT_SETTINGS };
let supabaseClient = null;
let r2Client = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();
  initClients();
  setupDragAndDrop();
  setupFormBindings();
  
  // Load gallery if tab was refreshed or is visible (default is upload)
  switchTab('upload');
});

// Load Settings from LocalStorage
function loadSettings() {
  // Clear localStorage once if access keys are empty or if they contain the old defaults
  try {
    const raw = localStorage.getItem('basic_wallpaper_admin_settings');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (!parsed.r2AccessKey || !parsed.r2SecretKey || parsed.r2Bucket === 'wallpaper-videos-new') {
        localStorage.removeItem('basic_wallpaper_admin_settings');
      }
    }
  } catch (e) {}

  const saved = localStorage.getItem('basic_wallpaper_admin_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
      
      // Fallback empty localStorage values to newly set defaults
      if (!settings.r2AccountId) settings.r2AccountId = DEFAULT_SETTINGS.r2AccountId;
      if (!settings.r2AccessKey) settings.r2AccessKey = DEFAULT_SETTINGS.r2AccessKey;
      if (!settings.r2SecretKey) settings.r2SecretKey = DEFAULT_SETTINGS.r2SecretKey;
      if (!settings.r2Bucket || settings.r2Bucket === 'wallpaper-videos-new') settings.r2Bucket = DEFAULT_SETTINGS.r2Bucket;
      if (!settings.r2CustomDomain || settings.r2CustomDomain.includes('pub-ea558d73cf444cc9d18b6fd1948cf828') || settings.r2CustomDomain.includes('pub-ea550d73efa44ce9a10a6fa1948cf626')) settings.r2CustomDomain = DEFAULT_SETTINGS.r2CustomDomain;
    } catch (e) {
      console.error('Failed to parse settings, using defaults.', e);
    }
  }
  
  // Populate settings form inputs
  document.getElementById('supabase-url').value = settings.supabaseUrl;
  document.getElementById('supabase-anon-key').value = settings.supabaseKey;
  document.getElementById('supabase-wallpapers-bucket').value = settings.supabaseWallpapersBucket;
  document.getElementById('supabase-thumbnails-bucket').value = settings.supabaseThumbnailsBucket;
  
  document.getElementById('r2-account-id').value = settings.r2AccountId;
  document.getElementById('r2-access-key').value = settings.r2AccessKey;
  document.getElementById('r2-secret-key').value = settings.r2SecretKey;
  document.getElementById('r2-bucket').value = settings.r2Bucket;
  document.getElementById('r2-region').value = settings.r2Region;
  document.getElementById('r2-custom-domain').value = settings.r2CustomDomain;
  document.getElementById('gemini-api-key').value = settings.geminiApiKey || '';

  // Restore active upload destination from preference
  const savedDest = localStorage.getItem('basic_wallpaper_upload_dest');
  if (savedDest === 'r2' || savedDest === 'supabase') {
    setDestination(savedDest);
  }
}

// Save Settings to LocalStorage
function saveSettings() {
  settings.supabaseUrl = document.getElementById('supabase-url').value.trim();
  settings.supabaseKey = document.getElementById('supabase-anon-key').value.trim();
  settings.supabaseWallpapersBucket = document.getElementById('supabase-wallpapers-bucket').value.trim() || 'wallpapers';
  settings.supabaseThumbnailsBucket = document.getElementById('supabase-thumbnails-bucket').value.trim() || 'thumbnails';
  
  settings.r2AccountId = document.getElementById('r2-account-id').value.trim();
  settings.r2AccessKey = document.getElementById('r2-access-key').value.trim();
  settings.r2SecretKey = document.getElementById('r2-secret-key').value.trim();
  settings.r2Bucket = document.getElementById('r2-bucket').value.trim();
  settings.r2Region = document.getElementById('r2-region').value.trim() || 'auto';
  settings.r2CustomDomain = document.getElementById('r2-custom-domain').value.trim();
  settings.geminiApiKey = document.getElementById('gemini-api-key').value.trim();
  
  // Format Custom Domain (remove trailing slash if any)
  if (settings.r2CustomDomain && settings.r2CustomDomain.endsWith('/')) {
    settings.r2CustomDomain = settings.r2CustomDomain.slice(0, -1);
  }

  localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
  showToast('Settings saved successfully!', 'success');
  
  // Re-initialize clients
  initClients();
}

// Initialize API Clients (Supabase, Cloudflare R2 S3)
async function initClients() {
  updateStatusBadge('supabase', 'offline');
  updateStatusBadge('r2', 'offline');

  // 1. Firebase Initialization
  const firebaseConfig = {
    apiKey: "AIzaSyAGWFhd9vm6UepVzaS87s5wVINL9ogym_4",
    authDomain: "glasscord-58675.firebaseapp.com",
    projectId: "glasscord-58675",
    storageBucket: "glasscord-58675.firebasestorage.app",
    messagingSenderId: "744549879312",
    appId: "1:744549879312:web:cf9d6d7323092d4099c495",
    measurementId: "G-Y344B0Z4Y7"
  };

  if (typeof firebase !== 'undefined' && !firebase.apps.length) {
    try {
      firebase.initializeApp(firebaseConfig);
    } catch (e) {
      console.warn('Firebase initialization failed:', e.message);
    }
  }

  // 1. Supabase Client Initialization
  if (typeof supabase !== 'undefined' && settings.supabaseUrl && settings.supabaseKey) {
    try {
      supabaseClient = supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
      
      // Test Supabase connection
      const { data, error } = await supabaseClient.from('community_wallpapers').select('id').limit(1);
      if (error) throw error;
      updateStatusBadge('supabase', 'online');
      updateAppealsBadge();
    } catch (e) {
      console.warn('Supabase Client fail:', e.message);
      updateStatusBadge('supabase', 'offline');
      supabaseClient = null;
    }
  } else {
    supabaseClient = null;
  }

  // 2. Cloudflare R2 — ping via Worker with retry (never hits blocked r2.cloudflarestorage.com)
  updateStatusBadge('r2', 'offline');
  r2Client = null;
  const MAX_RETRIES = 3;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout per attempt
      const pingResp = await fetch(WORKER_URL, { method: 'GET', signal: controller.signal });
      clearTimeout(timeout);
      // Any response means the Worker is alive
      r2Client = true;
      updateStatusBadge('r2', 'online');
      console.log(`R2 Worker reachable on attempt ${attempt}, status: ${pingResp.status}`);
      break;
    } catch (e) {
      console.warn(`R2 Worker ping attempt ${attempt} failed:`, e.message);
      if (attempt === MAX_RETRIES) {
        r2Client = null;
        updateStatusBadge('r2', 'offline');
        console.error('R2 Worker unreachable after all retries.');
      } else {
        await new Promise(r => setTimeout(r, 1000 * attempt)); // wait 1s, 2s before retry
      }
    }
  }
}

// Update Status Badge Visuals
function updateStatusBadge(provider, status) {
  const badge = document.getElementById(`${provider}-status-badge`);
  const dot = badge.querySelector('.status-dot');
  
  if (status === 'online') {
    dot.className = 'status-dot online';
    badge.style.color = '#fff';
    badge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
    badge.style.background = 'rgba(16, 185, 129, 0.05)';
  } else {
    dot.className = 'status-dot offline';
    badge.style.color = 'var(--text-secondary)';
    badge.style.borderColor = 'var(--border-panel)';
    badge.style.background = 'rgba(255, 255, 255, 0.03)';
  }
}

// Test All Connections Manual Trigger
async function testAllConnections() {
  showToast('Testing API endpoints...', 'warning');
  await initClients();
  
  // Report Supabase result
  if (!supabaseClient) {
    showToast('Supabase credentials missing or invalid.', 'danger');
  } else {
    const { error } = await supabaseClient.from('community_wallpapers').select('id').limit(1);
    if (error) {
      showToast(`Supabase DB failed: ${error.message}`, 'danger');
    } else {
      showToast('Supabase Connection Success!', 'success');
    }
  }

  // Report R2 Worker result (already tested inside initClients)
  if (r2Client) {
    showToast('Cloudflare R2 Worker Connection Success!', 'success');
  } else {
    showToast('R2 Worker unreachable — check Worker deployment.', 'danger');
  }
}

// Sidebar View Toggle Logic
function switchTab(tabId) {
  activeTab = tabId;
  
  // Highlight sidebar buttons
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`btn-tab-${tabId}`).classList.add('active');
  
  // Switch visible views
  document.querySelectorAll('.tab-content').forEach(view => view.classList.remove('active'));
  document.getElementById(`tab-${tabId}`).classList.add('active');
  
  // Set headers dynamically
  const title = document.getElementById('current-tab-title');
  const sub = document.getElementById('current-tab-subtitle');
  
  if (tabId === 'upload') {
    title.innerText = 'Bulk Upload Wallpapers';
    sub.innerText = 'Drag, configure, and batch upload premium live wallpapers';
  } else if (tabId === 'gallery') {
    title.innerText = 'Community Wallpaper Gallery';
    sub.innerText = 'Manage, preview, search, and delete wallpapers in the community database';
    fetchCommunityWallpapers();
  } else if (tabId === 'strikes') {
    title.innerText = 'Strikes & Bans';
    sub.innerText = 'Issue copyright strikes, manage blocked creators, and view strike history';
    fetchStrikes();
  } else if (tabId === 'reports') {
    title.innerText = 'User Reports';
    sub.innerText = 'Review, delete reported wallpapers, and moderate the community';
    fetchReports();
  } else if (tabId === 'appeals') {
    title.innerText = 'Creator Appeals';
    sub.innerText = 'Review, approve, or reject creator account recovery appeals';
    fetchAppeals();
  } else if (tabId === 'settings') {
    title.innerText = 'Cloud Storage Settings';
    sub.innerText = 'Configure database nodes, storage buckets, and R2 credentials';
  } else if (tabId === 'notifications') {
    title.innerText = 'Send Broadcast Notifications';
    sub.innerText = 'Manage system alerts and push news directly to active desktop software installations';
    fetchNotifications();
  }
}

// Storage Destination Selector Logic
function setDestination(dest) {
  uploadDestination = dest;
  localStorage.setItem('basic_wallpaper_upload_dest', dest);
  
  document.querySelectorAll('.destination-toggle-group .toggle-btn').forEach(btn => btn.classList.remove('active'));
  
  if (dest === 'supabase') {
    document.getElementById('dest-supabase').classList.add('active');
  } else {
    document.getElementById('dest-r2').classList.add('active');
  }
}

// Drag & Drop Setup
function setupDragAndDrop() {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-input');
  
  // Prevent defaults on drag
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, preventDefaults, false);
  });
  
  function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
  }
  
  // Add styling on hover
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.add('dragover'), false);
  });
  
  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, () => dropZone.classList.remove('dragover'), false);
  });
  
  // Handle drop
  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    handleUploadedFiles(files);
  });
  
  // Handle file picker selection
  fileInput.addEventListener('change', () => {
    handleUploadedFiles(fileInput.files);
  });
  
  // Handle folder picker selection
  const folderInput = document.getElementById('folder-input');
  if (folderInput) {
    folderInput.addEventListener('change', () => {
      handleUploadedFiles(folderInput.files);
    });
  }
}

// Helper to bind quick tags/bulk configs
function setupFormBindings() {
  // Bind Enter key on Search
  document.getElementById('gallery-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      filterGallery();
    }
  });
}

// Process Uploaded Files to Queue list
function handleUploadedFiles(files) {
  if (isUploading) {
    showToast('Cannot add files while uploads are in progress!', 'danger');
    return;
  }
  
  const filesArray = Array.from(files);
  
  filesArray.forEach(file => {
    const isVideo = file.type.startsWith('video/');
    const isImage = file.type.startsWith('image/');
    
    if (!isVideo && !isImage) {
      showToast(`Unsupported file format: ${file.name}`, 'warning');
      return;
    }

    if (isVideo && file.size > 150 * 1024 * 1024) {
      showToast(`Video size exceeds 150MB limit: ${file.name} (${formatBytes(file.size)})`, 'danger');
      return;
    }
    
    const title = formatTitleFromName(file.name);
    const tags = document.getElementById('bulk-tags').value.trim();
    const desc = document.getElementById('bulk-desc').value.trim();
    const bulkCat = document.getElementById('bulk-category').value || 'General';
    const category = (bulkCat === 'General') ? autoCategorize(title, tags, desc) : bulkCat;

    const item = {
      id: generateUniqueId(),
      file: file,
      name: file.name,
      size: file.size,
      type: isVideo ? 'video' : 'image',
      title: title,
      creator: document.getElementById('bulk-creator').value.trim() || 'Pavan Am',
      category: category,
      tags: tags,
      desc: desc,
      thumbnailDataUrl: '',
      thumbnailReady: null, // Promise that resolves when thumbnail is captured
      captureTime: 1.0,
      duration: 0,
      progress: 0,
      status: 'ready',
      statusText: 'Ready'
    };
    
    uploadQueue.push(item);
    renderQueueCard(item);
    
    // Generate thumbnail asynchronously; store the promise so upload can await it
    item.thumbnailReady = generateThumbnail(item);
  });
  
  updateQueueUI();
}

// Generate unique ID
function generateUniqueId() {
  return 'item_' + Math.random().toString(36).substring(2, 11) + '_' + Date.now();
}

// Auto format clean titles
function formatTitleFromName(filename) {
  let name = filename.substring(0, filename.lastIndexOf('.')) || filename;
  // Replace underscores, dashes, dots with spaces
  name = name.replace(/[_\-\.]/g, ' ');
  // Title Case
  return name.replace(/\w\S*/g, (txt) => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase());
}

// Format bytes
function formatBytes(bytes, decimals = 2) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Update Upload queue counts and panel visibility
function updateQueueUI() {
  const count = uploadQueue.length;
  document.getElementById('queue-count').innerText = count;
  
  const queueSection = document.getElementById('queue-section');
  if (count > 0) {
    queueSection.style.display = 'block';
  } else {
    queueSection.style.display = 'none';
  }
}

// Render dynamic queue item cards
function renderQueueCard(item) {
  const grid = document.getElementById('queue-grid');
  
  const card = document.createElement('div');
  card.className = 'queue-card';
  card.id = `card-${item.id}`;
  
  const isVideo = item.type === 'video';
  
  card.innerHTML = `
    <!-- Left Column: Media Preview & Thumb Config -->
    <div class="queue-media-preview">
      <div class="preview-container">
        <img id="img-preview-${item.id}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23111116'/%3E%3C/svg%3E" alt="Preview">
        <span class="video-badge">${item.type}</span>
      </div>
      
      ${isVideo ? `
      <div class="thumbnail-capture-control">
        <div class="slider-row">
          <label>Capture Frame</label>
          <span id="time-display-${item.id}">1.0s</span>
        </div>
        <input type="range" class="capture-slider" id="slider-${item.id}" min="0" max="10" step="0.1" value="1.0" oninput="updateItemCaptureTime('${item.id}', this.value)">
      </div>
      ` : ''}
    </div>
    
    <!-- Right Column: Metadata Inputs & Status -->
    <div class="queue-details-edit">
      <button class="card-remove-btn" onclick="removeFromQueue('${item.id}')">&times;</button>
      
      <div class="input-row" style="margin-bottom: 12px;">
        <div class="input-group" style="flex: 2;">
          <label>Wallpaper Title</label>
          <input type="text" value="${item.title}" oninput="updateItemField('${item.id}', 'title', this.value)">
        </div>
        <div class="input-group" style="flex: 1;">
          <label>Creator</label>
          <input type="text" value="${item.creator}" oninput="updateItemField('${item.id}', 'creator', this.value)">
        </div>
      </div>
      
      <div class="input-row" style="margin-bottom: 16px;">
        <div class="input-group" style="flex: 1;">
          <label>Category</label>
          <select style="background: #111116; color: #fff; border: 1px solid var(--border-panel); border-radius: 6px; padding: 10px; font-family: inherit; font-size: 14px; outline: none; transition: border-color 0.2s; color-scheme: dark;" onchange="updateItemField('${item.id}', 'category', this.value)">
            <option value="General" ${item.category === 'General' ? 'selected' : ''}>General</option>
            <option value="Games" ${item.category === 'Games' ? 'selected' : ''}>Games</option>
            <option value="Anime" ${item.category === 'Anime' ? 'selected' : ''}>Anime</option>
            <option value="Cars" ${item.category === 'Cars' ? 'selected' : ''}>Cars</option>
            <option value="Nature" ${item.category === 'Nature' ? 'selected' : ''}>Nature</option>
            <option value="Super Heroes" ${item.category === 'Super Heroes' ? 'selected' : ''}>Super Heroes</option>
          </select>
        </div>
        <div class="input-group" style="flex: 1;">
          <label>Format Type</label>
          <select style="background: #111116; color: #fff; border: 1px solid var(--border-panel); border-radius: 6px; padding: 10px; font-family: inherit; font-size: 14px; outline: none; transition: border-color 0.2s; color-scheme: dark;" onchange="updateItemField('${item.id}', 'type', this.value); updateCardTypeBadge('${item.id}', this.value)">
            <option value="video" ${item.type === 'video' ? 'selected' : ''}>Live (Video)</option>
            <option value="image" ${item.type === 'image' ? 'selected' : ''}>4K Wallpaper (Picture)</option>
          </select>
        </div>
        <div class="input-group" style="flex: 1;">
          <label>Tags (separated by comma)</label>
          <input type="text" value="${item.tags}" placeholder="e.g. dynamic, colorful" oninput="updateItemField('${item.id}', 'tags', this.value)">
        </div>
        <div class="input-group" style="flex: 2;">
          <label>Description</label>
          <input type="text" value="${item.desc}" placeholder="Describe this wallpaper" oninput="updateItemField('${item.id}', 'desc', this.value)">
        </div>
      </div>
      
      <!-- Upload Progress Monitor -->
      <div class="card-upload-status">
        <div class="status-label-row">
          <span class="status-txt" id="status-txt-${item.id}">Status: Ready (${formatBytes(item.size)})</span>
          <span class="status-percent" id="percent-txt-${item.id}">0%</span>
        </div>
        <div class="progress-container">
          <div class="progress-bar" id="bar-${item.id}"></div>
        </div>
      </div>
    </div>
  `;
  
  grid.appendChild(card);
}

// Generate thumbnail logic — returns a Promise that resolves when the frame is captured
function generateThumbnail(item) {
  const file = item.file;
  const imgElement = document.getElementById(`img-preview-${item.id}`);
  
  if (item.type === 'image') {
    // For images, resolve immediately after FileReader loads
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        item.thumbnailDataUrl = e.target.result;
        if (imgElement) imgElement.src = e.target.result;
        resolve();
      };
      reader.onerror = () => resolve(); // resolve anyway so upload isn't blocked
      reader.readAsDataURL(file);
    });
  }
  
  // For videos, seek and draw frame on canvas
  return new Promise((resolve) => {
    const video = document.createElement('video');
    video.style.display = 'none';
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    
    const objectUrl = URL.createObjectURL(file);
    video.src = objectUrl;
    
    video.addEventListener('loadedmetadata', () => {
      item.duration = video.duration;
      const slider = document.getElementById(`slider-${item.id}`);
      if (slider) {
        slider.max = video.duration;
        const defaultTime = Math.min(1.0, video.duration);
        slider.value = defaultTime;
        item.captureTime = defaultTime;
        const display = document.getElementById(`time-display-${item.id}`);
        if (display) display.innerText = `${defaultTime.toFixed(1)}s`;
        video.currentTime = defaultTime;
      } else {
        video.currentTime = Math.min(1.0, video.duration);
      }
    });
    
    video.addEventListener('seeked', () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 640;
        canvas.height = 360;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        item.thumbnailDataUrl = dataUrl;
        if (imgElement) imgElement.src = dataUrl;
      } catch (e) {
        console.error('Canvas capture failed:', e);
      } finally {
        URL.revokeObjectURL(objectUrl);
        video.remove();
        resolve(); // always resolve so upload isn't permanently blocked
      }
    });

    video.addEventListener('error', (e) => {
      console.error('Error loading video for thumbnail:', e);
      URL.revokeObjectURL(objectUrl);
      video.remove();
      resolve(); // resolve anyway
    });

    // Safety timeout: resolve after 10s even if video never fires events
    setTimeout(() => resolve(), 10000);
  });
}

// Regenerate frame on slider adjustment
function updateItemCaptureTime(itemId, time) {
  const item = uploadQueue.find(i => i.id === itemId);
  if (!item || item.type !== 'video') return;
  
  item.captureTime = parseFloat(time);
  
  const display = document.getElementById(`time-display-${itemId}`);
  if (display) display.innerText = `${item.captureTime.toFixed(1)}s`;
  
  // Re-generate frame
  const video = document.createElement('video');
  video.style.display = 'none';
  video.muted = true;
  video.playsInline = true;
  
  const objectUrl = URL.createObjectURL(item.file);
  video.src = objectUrl;
  
  video.addEventListener('loadedmetadata', () => {
    video.currentTime = item.captureTime;
  });
  
  video.addEventListener('seeked', () => {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 640;
      canvas.height = 360;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
      item.thumbnailDataUrl = dataUrl;
      
      const imgElement = document.getElementById(`img-preview-${itemId}`);
      if (imgElement) imgElement.src = dataUrl;
    } catch (e) {
      console.error('Canvas capture failed on adjust:', e);
    } finally {
      URL.revokeObjectURL(objectUrl);
      video.remove();
    }
  });
}

// Update fields dynamically in state array
function updateItemField(itemId, field, value) {
  const item = uploadQueue.find(i => i.id === itemId);
  if (item) {
    item[field] = value;
  }
}

function updateCardTypeBadge(itemId, value) {
  const card = document.getElementById(`card-${itemId}`);
  if (card) {
    const badge = card.querySelector('.video-badge');
    if (badge) {
      badge.textContent = value;
    }
  }
}

// Apply bulk parameters to queue list
function applyBulkMetadata() {
  const creator = document.getElementById('bulk-creator').value.trim();
  const category = document.getElementById('bulk-category').value;
  const type = document.getElementById('bulk-type').value;
  const tags = document.getElementById('bulk-tags').value.trim();
  const desc = document.getElementById('bulk-desc').value.trim();
  
  if (!creator && !category && !type && !tags && !desc) {
    showToast('Please fill in at least one bulk edit field.', 'warning');
    return;
  }
  
  uploadQueue.forEach(item => {
    if (creator) item.creator = creator;
    if (category) item.category = category;
    if (type) item.type = type;
    if (tags) item.tags = tags;
    if (desc) item.desc = desc;
  });
  
  // Re-render inputs in cards
  uploadQueue.forEach(item => {
    const card = document.getElementById(`card-${item.id}`);
    if (card) {
      const creatorInput = card.querySelector('input[oninput*="creator"]');
      const categorySelect = card.querySelector('select[onchange*="category"]');
      const typeSelect = card.querySelector('select[onchange*="type"]');
      const tagsInput = card.querySelector('input[oninput*="tags"]');
      const descInput = card.querySelector('input[oninput*="desc"]');

      if (creator && creatorInput) creatorInput.value = creator;
      if (category && categorySelect) categorySelect.value = category;
      if (type && typeSelect) {
        typeSelect.value = type;
        updateCardTypeBadge(item.id, type);
      }
      if (tags && tagsInput) tagsInput.value = tags;
      if (desc && descInput) descInput.value = desc;
    }
  });
  
  showToast('Bulk metadata applied to all queue items.', 'success');
}

// Remove card from upload list
function removeFromQueue(itemId) {
  if (isUploading) return;
  
  uploadQueue = uploadQueue.filter(item => item.id !== itemId);
  const card = document.getElementById(`card-${itemId}`);
  if (card) card.remove();
  
  updateQueueUI();
}

// Reset entire upload view
function clearQueue() {
  if (isUploading) return;
  
  uploadQueue = [];
  document.getElementById('queue-grid').innerHTML = '';
  updateQueueUI();
  showToast('Queue cleared.', 'info');
}

// Show Toast Alert
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  if (type === 'success') icon = '✅';
  if (type === 'danger') icon = '❌';
  if (type === 'warning') icon = '⚠️';
  
  toast.innerHTML = `<span>${icon}</span> <div style="margin-left: 8px;">${message}</div>`;
  container.appendChild(toast);
  
  // Trigger animations
  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => {
      toast.remove();
    }, 300);
  }, 4000);
}

// Convert base64 dataURL to Blob for S3/Supabase upload
function dataURLtoBlob(dataurl) {
  const arr = dataurl.split(',');
  const mime = arr[0].match(/:(.*?);/)[1];
  const bstr = atob(arr[1]);
  let n = bstr.length;
  const u8arr = new Uint8Array(n);
  while (n--) {
    u8arr[n] = bstr.charCodeAt(n);
  }
  return new Blob([u8arr], { type: mime });
}

// Generate dynamic file path uuid names
function generateRandomFilename(ext) {
  const rand = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
  return `${Date.now()}_${rand}${ext}`;
}

// START BATCH UPLOADS - ORCHESTRATION LAYER
async function startBatchUpload() {
  if (isUploading) return;
  
  if (uploadQueue.length === 0) {
    showToast('Queue is empty. Add files first.', 'warning');
    return;
  }

  // Validate credentials based on active destination
  if (uploadDestination === 'supabase') {
    if (!supabaseClient) {
      showToast('Supabase client is not connected. Check credentials in Settings!', 'danger');
      return;
    }
  } else {
    // R2 uploads go through the Cloudflare Worker — just need Supabase for DB indexing
    if (!supabaseClient) {
      showToast('Supabase connection needed for database indexing!', 'danger');
      return;
    }
  }

  isUploading = true;
  disableControlUI(true);
  
  showToast(`Starting batch upload of ${uploadQueue.length} items to ${uploadDestination === 'supabase' ? 'Supabase' : 'Cloudflare R2'}...`, 'info');

  // Limit concurrency to 2 uploads at a time
  const concurrencyLimit = 2;
  const itemsToUpload = [...uploadQueue.filter(item => item.status !== 'success')];
  
  let index = 0;
  
  async function worker() {
    while (index < itemsToUpload.length) {
      const item = itemsToUpload[index++];
      if (!item) break;
      
      try {
        await executeItemUpload(item);
      } catch (err) {
        console.error(`Error uploading ${item.name}:`, err);
      }
    }
  }

  const workers = [];
  for (let i = 0; i < Math.min(concurrencyLimit, itemsToUpload.length); i++) {
    workers.push(worker());
  }

  await Promise.all(workers);
  
  isUploading = false;
  disableControlUI(false);
  
  // Show final results alert
  const failedCount = uploadQueue.filter(i => i.status === 'error').length;
  if (failedCount > 0) {
    showToast(`Batch completed with ${failedCount} errors.`, 'danger');
  } else {
    showToast('All wallpapers successfully uploaded to community!', 'success');
    // Clear completed queue after short delay
    setTimeout(() => {
      uploadQueue = uploadQueue.filter(i => i.status !== 'success');
      document.getElementById('queue-grid').innerHTML = '';
      uploadQueue.forEach(renderQueueCard);
      updateQueueUI();
    }, 2000);
  }
}

// Lock buttons during uploads
function disableControlUI(disable) {
  document.getElementById('start-upload-btn').disabled = disable;
  document.querySelectorAll('.card-remove-btn').forEach(btn => btn.disabled = disable);
  document.querySelectorAll('.btn-danger').forEach(btn => btn.disabled = disable);
  document.querySelectorAll('.capture-slider').forEach(slider => slider.disabled = disable);
  document.querySelectorAll('.destination-toggle-group button').forEach(btn => btn.disabled = disable);
  document.getElementById('file-input').disabled = disable;
  const folderInput = document.getElementById('folder-input');
  if (folderInput) folderInput.disabled = disable;
}

// INDIVIDUAL UPLOAD WORKER
async function executeItemUpload(item) {
  updateCardStatus(item, 'uploading', 'Preparing files...', 5);

  // ── Wait for thumbnail to be fully captured before uploading ──
  if (item.thumbnailReady) {
    updateCardStatus(item, 'uploading', 'Generating thumbnail...', 10);
    await item.thumbnailReady;
  }
  
  const ext = item.name.substring(item.name.lastIndexOf('.'));
  const remoteMediaName = generateRandomFilename(ext);
  const remoteThumbName = generateRandomFilename('.jpg');
  
  let mediaPublicUrl = '';
  let thumbPublicUrl = '';
  
  // 1. Build thumbnail blob
  let thumbBlob;
  if (item.thumbnailDataUrl && item.thumbnailDataUrl.startsWith('data:')) {
    thumbBlob = dataURLtoBlob(item.thumbnailDataUrl);
  } else {
    // Thumbnail not available — create a small solid-color placeholder JPEG
    const canvas = document.createElement('canvas');
    canvas.width = 4; canvas.height = 4;
    canvas.getContext('2d').fillRect(0, 0, 4, 4);
    thumbBlob = dataURLtoBlob(canvas.toDataURL('image/jpeg', 0.5));
  }

  try {
    // ── STEP A: Upload Thumbnail ──
    updateCardStatus(item, 'uploading', 'Uploading thumbnail...', 20);
    if (uploadDestination === 'supabase') {
      const { data, error } = await supabaseClient.storage
        .from(settings.supabaseThumbnailsBucket)
        .upload(remoteThumbName, thumbBlob, { contentType: 'image/jpeg' });
        
      if (error) throw new Error(`Thumbnail upload failed: ${error.message}`);
      
      thumbPublicUrl = supabaseClient.storage
        .from(settings.supabaseThumbnailsBucket)
        .getPublicUrl(remoteThumbName).data.publicUrl;
    } else {
      // Cloudflare R2 Thumbnail Upload via Worker
      const thumbForm = new FormData();
      thumbForm.append('type', 'thumbnail');
      thumbForm.append('filename', remoteThumbName);
      thumbForm.append('file', thumbBlob);
      const thumbResp = await fetch(WORKER_URL, { method: 'POST', body: thumbForm });
      if (!thumbResp.ok) throw new Error(`Thumbnail upload failed: ${thumbResp.statusText}`);
      const thumbData = await thumbResp.json();
      thumbPublicUrl = thumbData.url || '';
      if (thumbPublicUrl && settings.r2CustomDomain) {
        try {
          const parsedUrl = new URL(thumbPublicUrl);
          const customDomainUrl = new URL(settings.r2CustomDomain.startsWith('http') ? settings.r2CustomDomain : 'https://' + settings.r2CustomDomain);
          parsedUrl.hostname = customDomainUrl.hostname;
          thumbPublicUrl = parsedUrl.toString();
        } catch (e) {
          console.warn("Error mapping thumbnail custom domain:", e);
        }
      }
    }

    // ── STEP B: Upload Media File ──
    updateCardStatus(item, 'uploading', 'Uploading media file...', 40);
    
    if (uploadDestination === 'supabase') {
      if (item.file.size > 50 * 1024 * 1024) {
        throw new Error("File exceeds Supabase free tier size limit of 50MB. Please select Cloudflare R2 as the upload destination.");
      }
      // Supabase Storage uses raw files. We don't have progress callbacks on storage.upload, 
      // so we simulate progress updates for visual feedback
      let simulatedProgress = 40;
      const progressTimer = setInterval(() => {
        if (simulatedProgress < 85) {
          simulatedProgress += 5;
          updateCardStatus(item, 'uploading', 'Uploading media file...', simulatedProgress);
        }
      }, 500);

      const { data, error } = await supabaseClient.storage
        .from(settings.supabaseWallpapersBucket)
        .upload(remoteMediaName, item.file, { contentType: item.file.type });
        
      clearInterval(progressTimer);
      if (error) throw new Error(`Media upload failed: ${error.message}`);
      
      mediaPublicUrl = supabaseClient.storage
        .from(settings.supabaseWallpapersBucket)
        .getPublicUrl(remoteMediaName).data.publicUrl;
    } else {
      // Cloudflare R2 Media File Upload with actual progress tracking
      const workerUrl = 'https://solitary-sound-f6ff.pavanam926.workers.dev';
        const mediaForm = new FormData();
        mediaForm.append('type', 'media');
        mediaForm.append('filename', remoteMediaName);
        mediaForm.append('file', item.file);
        const mediaResp = await fetch(workerUrl, {
          method: 'POST',
          body: mediaForm
        });
        if (!mediaResp.ok) {
          throw new Error(`Media upload failed: ${mediaResp.statusText}`);
        }
        const mediaData = await mediaResp.json();
        mediaPublicUrl = mediaData.url || '';
        if (mediaPublicUrl && settings.r2CustomDomain) {
          try {
            const parsedUrl = new URL(mediaPublicUrl);
            const customDomainUrl = new URL(settings.r2CustomDomain.startsWith('http') ? settings.r2CustomDomain : 'https://' + settings.r2CustomDomain);
            parsedUrl.hostname = customDomainUrl.hostname;
            mediaPublicUrl = parsedUrl.toString();
          } catch (e) {
            console.warn("Error mapping media custom domain:", e);
          }
        }
    }

    // ── STEP C: Save Record to Supabase DB ──
    updateCardStatus(item, 'uploading', 'Saving database record...', 90);
    
    const dbRecord = {
      title: item.title,
      creator: item.creator,
      category: item.category || 'General',
      tags: item.tags,
      description: item.desc,
      file_url: mediaPublicUrl,
      thumbnail_url: thumbPublicUrl,
      is_video: item.type === 'video',
      user_id: 'admin_portal'
    };

    // Check if the key being used is the anon key
    const isAnonKey = settings.supabaseKey && settings.supabaseKey.includes('icm9sZSI6ImFub24i'); // base64 for "role":"anon"
    if (isAnonKey) {
      throw new Error(`You are using the 'anon' key. Uploading from the admin dashboard requires the 'service_role' key. Please go to Supabase -> Project Settings -> API and copy the service_role secret.`);
    }

    const { error: dbError } = await supabaseClient
      .from('community_wallpapers')
      .insert([dbRecord]);

    if (dbError) throw new Error(`Database save failed: ${dbError.message}. Did you use the service_role key?`);

    // Completed successfully!
    updateCardStatus(item, 'success', 'Done', 100);
  } catch (err) {
    console.error(err);
    updateCardStatus(item, 'error', `Failed: ${err.message}`, 0);
  }
}

// Update card UI values
function updateCardStatus(item, status, text, percent) {
  item.status = status;
  item.statusText = text;
  item.progress = percent;
  
  const statusTxt = document.getElementById(`status-txt-${item.id}`);
  const percentTxt = document.getElementById(`percent-txt-${item.id}`);
  const bar = document.getElementById(`bar-${item.id}`);
  
  if (statusTxt) statusTxt.innerText = `Status: ${text}`;
  if (percentTxt) percentTxt.innerText = `${percent}%`;
  
  if (bar) {
    bar.style.width = `${percent}%`;
    bar.className = 'progress-bar';
    if (status === 'success') bar.classList.add('success');
    if (status === 'error') bar.classList.add('error');
  }
}

// GALLERY MANAGEMENT: Fetch database items
async function fetchCommunityWallpapers() {
  if (!supabaseClient) {
    document.getElementById('gallery-loading').style.display = 'none';
    document.getElementById('gallery-empty').style.display = 'flex';
    document.getElementById('gallery-empty').querySelector('p').innerText = 'Connect to Supabase in settings first.';
    return;
  }
  
  document.getElementById('gallery-loading').style.display = 'flex';
  document.getElementById('gallery-grid').style.display = 'none';
  document.getElementById('gallery-empty').style.display = 'none';
  
  try {
    const { data, error } = await supabaseClient
      .from('community_wallpapers')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    
    communityWallpapers = data || [];
    renderGallery();
  } catch (err) {
    console.error('Gallery Fetch Error:', err);
    showToast(`Failed to load community wallpapers: ${err.message}`, 'danger');
    document.getElementById('gallery-loading').style.display = 'none';
    document.getElementById('gallery-empty').style.display = 'flex';
  }
}

// Render Gallery items
function renderGallery(items = communityWallpapers) {
  document.getElementById('gallery-loading').style.display = 'none';
  
  const grid = document.getElementById('gallery-grid');
  grid.innerHTML = '';
  
  if (items.length === 0) {
    document.getElementById('gallery-grid').style.display = 'none';
    document.getElementById('gallery-empty').style.display = 'flex';
    return;
  }
  
  document.getElementById('gallery-empty').style.display = 'none';
  grid.style.display = 'grid';
  
  items.forEach(wp => {
    // Determine storage provider for badge display
    let provider = 'Supabase';
    if (wp.file_url && wp.file_url.includes('r2.cloudflarestorage.com') || (settings.r2CustomDomain && wp.file_url.includes(settings.r2CustomDomain.replace('https://', '').replace('http://', '')))) {
      provider = 'Cloudflare R2';
    }
    
    const card = document.createElement('div');
    card.className = 'gallery-card';
    card.id = `gallery-card-${wp.id}`;
    
    const createdDate = new Date(wp.created_at).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
    
    const isStruck = wp.is_struck === true;

    card.innerHTML = `
      <div class="gallery-thumb-container">
        <img src="${wp.thumbnail_url || 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3C/svg%3E'}" alt="${wp.title}" loading="lazy">
        <button class="gallery-play-btn" onclick="openPreviewModal('${wp.file_url}', '${wp.is_video}', '${escapeHtml(wp.title)}', '${escapeHtml(wp.description)}')">
          <svg width="24" height="24" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <span class="category-badge" style="position: absolute; top: 10px; left: 10px; padding: 4px 8px; border-radius: 4px; font-size: 10px; font-weight: bold; background: rgba(0,0,0,0.65); color: #7F56D9; text-transform: uppercase; border: 1px solid rgba(127, 86, 217, 0.3);">${wp.category || 'General'}</span>
        <span class="provider-badge">${provider}</span>
        ${isStruck ? '<span class="strike-badge">⚠️ STRUCK</span>' : ''}
      </div>
      <div class="gallery-card-info">
        <div class="gallery-card-header">
          <h4 class="gallery-title" title="${wp.title}">${wp.title}</h4>
        </div>
        <span class="gallery-creator">By ${wp.creator || 'Anonymous'}</span>
        <p class="gallery-desc" title="${wp.description || ''}">${wp.description || 'No description provided.'}</p>
        <div class="gallery-tags-wrapper">
          ${wp.tags ? wp.tags.split(',').map(t => `<span class="gallery-tag">${t.trim()}</span>`).join('') : '<span class="gallery-tag">no tags</span>'}
        </div>
      </div>
      <div class="gallery-card-footer">
        <span class="gallery-date">${createdDate}</span>
        <div style="display:flex;gap:6px;align-items:center;">
          <button class="gallery-strike-btn ${isStruck ? 'active-strike' : ''}" 
            onclick="openStrikeModal('${wp.id}', '${escapeHtml(wp.creator || 'Unknown')}', '${escapeHtml(wp.title)}')" 
            title="Issue Strike">
            ⚠️ Strike
          </button>
          <button class="gallery-delete-btn" onclick="deleteWallpaper('${wp.id}', '${wp.file_url}', '${wp.thumbnail_url}')" title="Delete Wallpaper">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>
          </button>
        </div>
      </div>
    `;

    if (isStruck) card.classList.add('is-struck');
    
    card.addEventListener('contextmenu', e => {
      e.preventDefault();
      showGalleryContextMenu(e, wp.id);
    });
    
    grid.appendChild(card);
  });
}

// Live filter gallery items
function filterGallery() {
  const query = document.getElementById('gallery-search').value.toLowerCase().trim();
  const type = document.getElementById('gallery-type-filter').value;
  const category = document.getElementById('gallery-category-filter').value;
  
  const filtered = communityWallpapers.filter(wp => {
    // 1. Text Filter
    const titleMatch = wp.title && wp.title.toLowerCase().includes(query);
    const creatorMatch = wp.creator && wp.creator.toLowerCase().includes(query);
    const descMatch = wp.description && wp.description.toLowerCase().includes(query);
    const tagMatch = wp.tags && wp.tags.toLowerCase().includes(query);
    
    const matchesText = !query || (titleMatch || creatorMatch || descMatch || tagMatch);
    
    // 2. Type Filter
    let matchesType = true;
    if (type === 'video') matchesType = wp.is_video;
    if (type === 'image') matchesType = !wp.is_video;

    // 3. Category Filter
    let matchesCategory = true;
    if (category !== 'all') {
      matchesCategory = (wp.category || 'General') === category;
    }
    
    return matchesText && matchesType && matchesCategory;
  });
  
  renderGallery(filtered);
}

// DELETION LOGIC (MODERATOR CONTROL)
async function deleteWallpaper(id, fileUrl, thumbnailUrl) {
  const confirmDelete = confirm('Are you sure you want to permanently delete this wallpaper from the community? This will delete both the database record and the files in the storage bucket.');
  if (!confirmDelete) return;

  try {
    showToast('Deleting wallpaper...', 'warning');
    
    // 1. Delete DB record
    const { error: dbError } = await supabaseClient
      .from('community_wallpapers')
      .delete()
      .eq('id', id);

    if (dbError) throw new Error(`Database deletion failed: ${dbError.message}`);

    // 2. Extract filenames and delete from Storage (Supabase or R2)
    // Delete Media file
    try {
      if (fileUrl.includes('supabase.co')) {
        const mediaFileName = fileUrl.split('/').pop();
        await supabaseClient.storage.from(settings.supabaseWallpapersBucket).remove([mediaFileName]);
      } else if (r2Client && fileUrl.includes(settings.r2CustomDomain.replace('https://','').replace('http://',''))) {
        // R2 deletion
        const key = 'wallpapers/' + fileUrl.split('/wallpapers/')[1];
        await r2Client.deleteObject({ Key: key }).promise();
      }
    } catch (err) {
      console.warn('Storage media file deletion failed (might have been deleted manually):', err);
    }

    // Delete Thumbnail file
    try {
      if (thumbnailUrl && thumbnailUrl.includes('supabase.co')) {
        const thumbFileName = thumbnailUrl.split('/').pop();
        await supabaseClient.storage.from(settings.supabaseThumbnailsBucket).remove([thumbFileName]);
      } else if (r2Client && thumbnailUrl && thumbnailUrl.includes(settings.r2CustomDomain.replace('https://','').replace('http://',''))) {
        // R2 deletion
        const key = 'thumbnails/' + thumbnailUrl.split('/thumbnails/')[1];
        await r2Client.deleteObject({ Key: key }).promise();
      }
    } catch (err) {
      console.warn('Storage thumbnail deletion failed:', err);
    }

    showToast('Wallpaper deleted successfully.', 'success');
    
    // Remove card from UI
    communityWallpapers = communityWallpapers.filter(wp => wp.id !== id);
    const card = document.getElementById(`gallery-card-${id}`);
    if (card) card.remove();
    
    if (communityWallpapers.length === 0) {
      renderGallery();
    }
  } catch (err) {
    console.error('Delete error:', err);
    showToast(`Failed to delete wallpaper: ${err.message}`, 'danger');
  }
}

// Video Playback Modal Controls
function openPreviewModal(url, isVideo, title, desc) {
  const modal = document.getElementById('preview-modal');
  const video = document.getElementById('modal-video');
  const img = document.getElementById('modal-image');

  // Remove any previous error overlay
  const prevErr = modal.querySelector('.modal-video-error');
  if (prevErr) prevErr.remove();

  document.getElementById('modal-title').innerText = title;
  document.getElementById('modal-desc').innerText = desc || 'No description.';

  if (isVideo === 'true' || isVideo === true) {
    // Guard: if URL is empty, show a message immediately
    if (!url || url === 'undefined' || url === 'null') {
      showVideoError('No video URL stored. This wallpaper may not have uploaded correctly.');
      modal.classList.add('active');
      return;
    }

    console.log('[Modal] Loading video from URL:', url);
    video.style.display = 'block';
    img.style.display = 'none';
    video.src = url;

    // Clear previous handlers to avoid duplicates
    video.onerror = null;
    video.onstalled = null;

    // Show detailed error if video fails to load
    video.onerror = (e) => {
      const code = video.error ? video.error.code : '?';
      const msgs = {
        1: 'MEDIA_ERR_ABORTED – Playback aborted.',
        2: 'MEDIA_ERR_NETWORK – Network error while loading video. Check if the R2 bucket has public access enabled.',
        3: 'MEDIA_ERR_DECODE – Video could not be decoded.',
        4: 'MEDIA_ERR_SRC_NOT_SUPPORTED – Video format not supported or file not found at: ' + url,
      };
      const msg = msgs[code] || `Unknown error (code ${code})`;
      console.error('[Modal] Video error:', msg, 'URL:', url);
      showVideoError(msg);
    };

    video.load();
    video.play().catch(e => console.warn('[Modal] Autoplay blocked:', e.message));
  } else {
    if (!url || url === 'undefined') {
      showVideoError('No image URL stored.');
      modal.classList.add('active');
      return;
    }
    video.style.display = 'none';
    img.style.display = 'block';
    img.onerror = () => showVideoError('Image failed to load from: ' + url);
    img.src = url;
  }

  modal.classList.add('active');
}

// Show an error overlay inside the modal video wrapper
function showVideoError(message) {
  const video = document.getElementById('modal-video');
  video.style.display = 'none';
  const wrapper = video.parentElement;
  const err = document.createElement('div');
  err.className = 'modal-video-error';
  err.style.cssText = 'display:flex;flex-direction:column;align-items:center;justify-content:center;height:240px;color:#ff6b6b;font-size:14px;text-align:center;padding:24px;gap:12px;';
  err.innerHTML = `<span style="font-size:40px">⚠️</span><p style="margin:0;font-weight:600;">Video failed to load</p><p style="margin:0;color:#999;font-size:12px">${message}</p>`;
  wrapper.appendChild(err);
}

function closePreviewModal() {
  const modal = document.getElementById('preview-modal');
  const video = document.getElementById('modal-video');
  video.pause();
  video.onerror = null;
  video.src = '';
  const err = modal.querySelector('.modal-video-error');
  if (err) err.remove();
  modal.classList.remove('active');
}

// Escape HTML utility
function escapeHtml(unsafe) {
  if (!unsafe) return '';
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// --- Category Right-Click Context Menu Logic ---
let contextMenuTargetId = null;

function showGalleryContextMenu(e, id) {
  contextMenuTargetId = id;
  const menu = document.getElementById('gallery-context-menu');
  if (!menu) return;
  
  const wp = communityWallpapers.find(w => w.id === id);
  const changeThumbBtn = document.getElementById('gallery-context-change-thumb');
  const divider = document.getElementById('gallery-context-divider');
  
  let menuHeight = 270;
  if (changeThumbBtn && divider) {
    if (wp && wp.is_video) {
      changeThumbBtn.style.display = 'block';
      divider.style.display = 'block';
      menuHeight = 320;
    } else {
      changeThumbBtn.style.display = 'none';
      divider.style.display = 'none';
      menuHeight = 260;
    }
  }

  menu.style.display = 'block';
  
  // Align position with cursor, ensuring it doesn't overflow viewport boundaries
  const menuWidth = 160;
  let x = e.pageX;
  let y = e.pageY;
  
  if (x + menuWidth > window.pageXOffset + window.innerWidth) {
    x = window.pageXOffset + window.innerWidth - menuWidth - 10;
  }
  if (y + menuHeight > window.pageYOffset + window.innerHeight) {
    y = window.pageYOffset + window.innerHeight - menuHeight - 10;
  }
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}

// Select category and update Database
async function selectCtxCategory(category) {
  if (!contextMenuTargetId) return;
  const id = contextMenuTargetId;
  contextMenuTargetId = null;
  
  await updateWallpaperCategory(id, category);
}

// Update wallpaper category in Supabase DB
async function updateWallpaperCategory(id, newCategory) {
  if (!supabaseClient) {
    showToast('Supabase client is not initialized.', 'error');
    return;
  }

  try {
    showToast('Updating category...', 'warning');
    
    const { error } = await supabaseClient
      .from('community_wallpapers')
      .update({ category: newCategory })
      .eq('id', id);

    if (error) throw error;

    showToast('Category updated successfully.', 'success');
    
    // Update local data array
    const wp = communityWallpapers.find(w => w.id === id);
    if (wp) {
      wp.category = newCategory;
    }
    
    // Update UI badge
    const card = document.getElementById(`gallery-card-${id}`);
    if (card) {
      const badge = card.querySelector('.category-badge');
      if (badge) {
        badge.textContent = newCategory;
      }
    }
  } catch (err) {
    showToast(`Failed to update category: ${err.message}`, 'error');
  }
}

// Open the thumbnail capture modal
function openThumbnailModalOption() {
  const menu = document.getElementById('gallery-context-menu');
  if (menu) menu.style.display = 'none'; // Hide context menu

  if (!contextMenuTargetId) return;
  const wp = communityWallpapers.find(w => w.id === contextMenuTargetId);
  if (!wp || !wp.is_video) return;

  const modal = document.getElementById('thumbnail-modal');
  const video = document.getElementById('thumb-capture-video');
  if (modal && video) {
    video.src = wp.file_url;
    modal.classList.add('active');
    video.play().catch(() => {});
  }
}

// Close the thumbnail modal
function closeThumbnailModal() {
  const modal = document.getElementById('thumbnail-modal');
  const video = document.getElementById('thumb-capture-video');
  if (modal && video) {
    video.pause();
    video.src = '';
    modal.classList.remove('active');
  }
}

// Capture current frame from the video and save it to storage + DB
async function captureAndSaveThumbnail() {
  if (!contextMenuTargetId) return;
  const id = contextMenuTargetId;
  const wp = communityWallpapers.find(w => w.id === id);
  if (!wp) return;

  const video = document.getElementById('thumb-capture-video');
  if (!video || !video.videoWidth) {
    showToast("Video frame is not ready yet.", "error");
    return;
  }

  try {
    showToast("Capturing and uploading thumbnail...", "warning");

    // 1. Capture frame on Canvas
    const canvas = document.createElement('canvas');
    // Calculate aspect ratio
    const width = 640;
    const height = Math.round((video.videoHeight / video.videoWidth) * width) || 360;
    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(video, 0, 0, width, height);

    // 2. Convert Canvas to Blob
    const thumbBlob = await new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Canvas toBlob failed"));
      }, 'image/jpeg', 0.85);
    });

    // 3. Upload to appropriate storage destination
    const remoteThumbName = `thumb_${Date.now()}_${Math.random().toString(36).substr(2, 9)}.jpg`;
    let newThumbnailUrl = '';

    // Determine storage target based on old thumbnail URL
    const checkUrl = wp.thumbnail_url || wp.file_url || '';
    const isSupabaseStorage = checkUrl.includes('supabase.co');

    if (isSupabaseStorage) {
      if (!supabaseClient) throw new Error("Supabase client is not initialized.");
      
      const { data, error } = await supabaseClient.storage
        .from(settings.supabaseThumbnailsBucket)
        .upload(remoteThumbName, thumbBlob, { contentType: 'image/jpeg' });
        
      if (error) throw error;
      
      newThumbnailUrl = supabaseClient.storage
        .from(settings.supabaseThumbnailsBucket)
        .getPublicUrl(remoteThumbName).data.publicUrl;
    } else {
      // Cloudflare R2 Upload via Worker
      const thumbForm = new FormData();
      thumbForm.append('type', 'thumbnail');
      thumbForm.append('filename', remoteThumbName);
      thumbForm.append('file', thumbBlob);
      
      const thumbResp = await fetch(WORKER_URL, { method: 'POST', body: thumbForm });
      if (!thumbResp.ok) throw new Error(`Thumbnail upload failed: ${thumbResp.statusText}`);
      
      const thumbData = await thumbResp.json();
      let r2Url = thumbData.url || '';
      
      // Fix R2 domain prefix using custom domain settings
      if (r2Url && settings.r2CustomDomain) {
        try {
          const parsedUrl = new URL(r2Url);
          const customDomainUrl = new URL(settings.r2CustomDomain.startsWith('http') ? settings.r2CustomDomain : 'https://' + settings.r2CustomDomain);
          parsedUrl.hostname = customDomainUrl.hostname;
          r2Url = parsedUrl.toString();
        } catch (e) {
          console.warn("Error mapping thumbnail custom domain:", e);
        }
      }
      newThumbnailUrl = r2Url;
    }

    if (!newThumbnailUrl) throw new Error("Failed to generate thumbnail URL.");

    // 4. Update Database
    const { error: dbError } = await supabaseClient
      .from('community_wallpapers')
      .update({ thumbnail_url: newThumbnailUrl })
      .eq('id', id);

    if (dbError) throw dbError;

    // 5. Delete old thumbnail file (if it exists) to save storage space
    const oldThumbnailUrl = wp.thumbnail_url;
    if (oldThumbnailUrl) {
      try {
        if (oldThumbnailUrl.includes('supabase.co')) {
          const oldFilename = oldThumbnailUrl.split('/').pop();
          await supabaseClient.storage.from(settings.supabaseThumbnailsBucket).remove([oldFilename]);
        } else if (r2Client && oldThumbnailUrl.includes(settings.r2CustomDomain.replace('https://','').replace('http://',''))) {
          const key = 'thumbnails/' + oldThumbnailUrl.split('/thumbnails/')[1];
          await r2Client.deleteObject({ Key: key }).promise();
        }
      } catch (delErr) {
        console.warn("Failed to delete old thumbnail file:", delErr);
      }
    }

    // 6. Update local state and gallery UI card thumbnail
    wp.thumbnail_url = newThumbnailUrl;
    const card = document.getElementById(`gallery-card-${id}`);
    if (card) {
      const img = card.querySelector('.gallery-thumb-container img');
      if (img) {
        // Append a cache buster query parameter to force re-render in browser
        img.src = `${newThumbnailUrl}?v=${Date.now()}`;
      }
    }

    showToast("Thumbnail regenerated successfully!", "success");
    closeThumbnailModal();
  } catch (err) {
    console.error("Thumbnail regeneration error:", err);
    showToast(`Failed to regenerate thumbnail: ${err.message}`, "danger");
  }
}

// Hide context menu when clicking outside
document.addEventListener('click', () => {
  const menu = document.getElementById('gallery-context-menu');
  if (menu) menu.style.display = 'none';
});

document.addEventListener('contextmenu', (e) => {
  // If we right clicked outside a gallery card, hide the context menu
  if (!e.target.closest('.gallery-card')) {
    const menu = document.getElementById('gallery-context-menu');
    if (menu) menu.style.display = 'none';
  }
});

// Auto categorizer utility
function autoCategorize(title = '', tags = '', desc = '') {
  const text = `${title} ${tags} ${desc}`.toLowerCase();
  
  const rules = [
    {
      category: 'Games',
      keywords: ['game', 'gaming', 'cyberpunk', 'gta', 'witcher', 'pubg', 'fortnite', 'xbox', 'playstation', 'nintendo', 'arknights', 'hsr', 'genshin', 'assassin', 'halo', 'minecraft', 'skyrim', 'fallout', 'cod', 'call of duty', 'elden ring', 'dark souls', 'zelda', 'mario', 'showdown', 'warrior', 'fortnite', 'apex']
    },
    {
      category: 'Anime',
      keywords: ['anime', 'anim', 'manga', 'goku', 'naruto', 'one piece', 'clove', 'tanjiro', 'demon slayer', 'lappland', 'texas', 'mitsuha', 'taki', 'kimi no na', 'your name', 'jujutsu', 'sukuna', 'ghoul', 'kaneki', 'nikke', 'shifty', 'otaku']
    },
    {
      category: 'Cars',
      keywords: ['car', 'bmw', 'nissan', 'nisaan', 'audi', 'toyota', 'porsche', 'ferrari', 'lamborghini', 'ford', 'mustang', 'supercar', 'vehicle', 'drive', 'racing', 'speed', 'drift', 'dodge', 'chevrolet']
    },
    {
      category: 'Nature',
      keywords: ['nature', 'forest', 'creek', 'lake', 'sky', 'cloud', 'river', 'mountain', 'ocean', 'sea', 'sunset', 'sunrise', 'tree', 'flower', 'rain', 'landscape', 'scenery', 'outdoor', 'waterfall', 'beach', 'wood']
    },
    {
      category: 'Super Heroes',
      keywords: ['superhero', 'hero', 'batman', 'superman', 'spiderman', 'spider-man', 'ironman', 'avengers', 'marvel', 'dc', 'joker', 'thor', 'wolverine', 'captain america']
    }
  ];

  for (const rule of rules) {
    for (const keyword of rule.keywords) {
      if (text.includes(keyword)) {
        return rule.category;
      }
    }
  }

  return 'General';
}


// =====================================================
// COPYRIGHT STRIKE SYSTEM
// =====================================================

// =====================================================
// COPYRIGHT STRIKE SYSTEM
// =====================================================

let currentStrikeTarget = { wallpaperId: null, creator: null, title: null, fileUrl: null, thumbnailUrl: null, reportId: null };
let selectedIntensity = null;

function openStrikeModal(wallpaperId, creator, title, fileUrl = null, thumbnailUrl = null, reportId = null) {
  currentStrikeTarget = { wallpaperId, creator, title, fileUrl, thumbnailUrl, reportId };
  
  // Set defaults in form
  document.getElementById('strike-duration-preset').value = '2_days';
  document.getElementById('duration-custom-row').style.display = 'none';
  document.getElementById('perm-ban-warning').classList.remove('visible');
  document.getElementById('strike-notes').value = '';
  document.getElementById('strike-duration-value').value = '3';
  document.getElementById('strike-duration-unit').value = 'days';
  document.getElementById('strike-delete-wallpaper').checked = true; // Default to checked
  
  // Reset intensity selector state
  document.querySelectorAll('.intensity-card').forEach(c => c.classList.remove('selected'));
  const defaultCard = document.querySelector('.intensity-card[data-level="low"]');
  if (defaultCard) defaultCard.classList.add('selected');
  selectedIntensity = 'low';

  document.getElementById('strike-confirm-btn').disabled = false;
  document.getElementById('strike-creator-display').textContent = creator + ' · "' + title + '"';
  document.getElementById('strike-modal-overlay').classList.add('active');
}
window.openStrikeModal = openStrikeModal;

function closeStrikeModal() {
  document.getElementById('strike-modal-overlay').classList.remove('active');
  currentStrikeTarget = { wallpaperId: null, creator: null, title: null, fileUrl: null, thumbnailUrl: null, reportId: null };
  selectedIntensity = null;
}
window.closeStrikeModal = closeStrikeModal;

function onPresetDurationChange() {
  const preset = document.getElementById('strike-duration-preset').value;
  const customRow = document.getElementById('duration-custom-row');
  const permWarn = document.getElementById('perm-ban-warning');
  
  customRow.style.display = 'none';
  permWarn.classList.remove('visible');
  
  let intensity = 'low';
  
  if (preset === 'warning') {
    intensity = 'warning';
  } else if (preset === '2_days' || preset === '5_days') {
    intensity = 'low';
  } else if (preset === '1_month' || preset === '6_months') {
    intensity = 'medium';
  } else if (preset === '1_year') {
    intensity = 'high';
  } else if (preset === 'permanent') {
    intensity = 'permanent';
    permWarn.classList.add('visible');
  } else if (preset === 'custom') {
    customRow.style.display = 'flex';
    intensity = 'medium';
  }
  
  selectedIntensity = intensity;
  document.querySelectorAll('.intensity-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.intensity-card[data-level="${intensity}"]`);
  if (card) card.classList.add('selected');
}
window.onPresetDurationChange = onPresetDurationChange;

function selectIntensity(level) {
  selectedIntensity = level;
  document.querySelectorAll('.intensity-card').forEach(c => c.classList.remove('selected'));
  const card = document.querySelector(`.intensity-card[data-level="${level}"]`);
  if (card) card.classList.add('selected');
  
  const presetSelect = document.getElementById('strike-duration-preset');
  const customRow = document.getElementById('duration-custom-row');
  const permWarn = document.getElementById('perm-ban-warning');
  
  customRow.style.display = 'none';
  permWarn.classList.toggle('visible', level === 'permanent');
  
  // Update preset dropdown based on selected card
  if (level === 'warning') {
    presetSelect.value = 'warning';
  } else if (level === 'low') {
    presetSelect.value = '2_days';
  } else if (level === 'medium') {
    presetSelect.value = '1_month';
  } else if (level === 'high') {
    presetSelect.value = '1_year';
  } else if (level === 'permanent') {
    presetSelect.value = 'permanent';
  }
}
window.selectIntensity = selectIntensity;

async function executeWallpaperDeletion(id, fileUrl, thumbnailUrl) {
  // 1. Delete DB record
  const { error: dbError } = await supabaseClient
    .from('community_wallpapers')
    .delete()
    .eq('id', id);

  if (dbError) throw new Error(`Database deletion failed: ${dbError.message}`);

  // 2. Extract filenames and delete from Storage
  if (fileUrl) {
    try {
      if (fileUrl.includes('supabase.co')) {
        const mediaFileName = fileUrl.split('/').pop();
        await supabaseClient.storage.from(settings.supabaseWallpapersBucket).remove([mediaFileName]);
      } else if (r2Client && fileUrl.includes(settings.r2CustomDomain.replace('https://','').replace('http://',''))) {
        const key = 'wallpapers/' + fileUrl.split('/wallpapers/')[1];
        await r2Client.deleteObject({ Key: key }).promise();
      }
    } catch (err) {
      console.warn('Storage media file deletion failed:', err);
    }
  }

  if (thumbnailUrl) {
    try {
      if (thumbnailUrl.includes('supabase.co') && !thumbnailUrl.includes('assets/logo.png')) {
        const thumbFileName = thumbnailUrl.split('/').pop();
        await supabaseClient.storage.from(settings.supabaseThumbnailsBucket).remove([thumbFileName]);
      } else if (r2Client && thumbnailUrl.includes(settings.r2CustomDomain.replace('https://','').replace('http://',''))) {
        const key = 'thumbnails/' + thumbnailUrl.split('/thumbnails/')[1];
        await r2Client.deleteObject({ Key: key }).promise();
      }
    } catch (err) {
      console.warn('Storage thumbnail deletion failed:', err);
    }
  }
}
window.executeWallpaperDeletion = executeWallpaperDeletion;

async function submitStrike() {
  const preset = document.getElementById('strike-duration-preset').value;
  const reason = document.getElementById('strike-reason').value;
  const notes = document.getElementById('strike-notes').value.trim();
  const creator = currentStrikeTarget.creator;
  const wallpaperId = currentStrikeTarget.wallpaperId;
  const deleteWallpaperChecked = document.getElementById('strike-delete-wallpaper').checked;

  if (!wallpaperId) return;

  const btn = document.getElementById('strike-confirm-btn');
  btn.disabled = true;
  btn.textContent = 'Issuing...';

  // Calculate intensity and block duration
  let intensity = selectedIntensity || 'low';
  let blockHours = null;
  let blockUntil = null;

  if (preset === 'warning') {
    intensity = 'warning';
  } else if (preset === '2_days') {
    intensity = 'low';
    blockHours = 2 * 24;
  } else if (preset === '5_days') {
    intensity = 'low';
    blockHours = 5 * 24;
  } else if (preset === '1_month') {
    intensity = 'medium';
    blockHours = 30 * 24;
  } else if (preset === '6_months') {
    intensity = 'medium';
    blockHours = 180 * 24;
  } else if (preset === '1_year') {
    intensity = 'high';
    blockHours = 365 * 24;
  } else if (preset === 'permanent') {
    intensity = 'permanent';
  } else if (preset === 'custom') {
    const val = parseInt(document.getElementById('strike-duration-value').value, 10) || 1;
    const unit = document.getElementById('strike-duration-unit').value;
    if (unit === 'hours') blockHours = val;
    else if (unit === 'days') blockHours = val * 24;
    else if (unit === 'weeks') blockHours = val * 24 * 7;
    else if (unit === 'months') blockHours = val * 24 * 30;
  }

  if (blockHours) {
    blockUntil = new Date(Date.now() + blockHours * 3600 * 1000).toISOString();
  }

  try {
    // 1. Insert strike record
    const { error: strikeErr } = await supabaseClient.from('strikes').insert({
      wallpaper_id: wallpaperId,
      creator,
      reason,
      intensity,
      block_hours: blockHours,
      block_until: blockUntil,
      notes: notes || null,
      is_active: true
    });
    if (strikeErr) throw strikeErr;

    // 2. Perform deletion if permanent ban or checkbox checked
    const shouldDelete = (intensity === 'permanent') || deleteWallpaperChecked;
    if (shouldDelete) {
      await executeWallpaperDeletion(wallpaperId, currentStrikeTarget.fileUrl, currentStrikeTarget.thumbnailUrl);
    } else {
      const markStruck = intensity !== 'warning';
      const { error: wpErr } = await supabaseClient
        .from('community_wallpapers')
        .update({ is_struck: markStruck, strike_reason: reason })
        .eq('id', wallpaperId);
      if (wpErr) throw wpErr;
    }

    // 3. Clear report if this strike was triggered from a report
    if (currentStrikeTarget.reportId) {
      await supabaseClient
        .from('site_analytics')
        .delete()
        .eq('id', currentStrikeTarget.reportId);
    }

    showToast(`Strike issued successfully!`, 'success');
    closeStrikeModal();
    
    // Refresh stats & views
    if (activeTab === 'reports') {
      fetchReports();
    } else {
      fetchCommunityWallpapers();
    }
    fetchStrikes();
    updateStrikesBadge();
  } catch (err) {
    showToast('Failed to issue strike: ' + err.message, 'danger');
    console.error('[Strike]', err);
  } finally {
    btn.disabled = false;
    btn.innerHTML = '⚠️ Issue Strike';
  }
}
window.submitStrike = submitStrike;

async function fetchStrikes() {
  if (!supabaseClient) return;
  const container   = document.getElementById('strikes-table-container');
  const blockedList = document.getElementById('blocked-creators-list');
  container.innerHTML   = '<div class="strikes-empty"><div class="empty-icon">⏳</div><p>Loading...</p></div>';
  blockedList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading...</p>';

  try {
    const { data: strikes, error } = await supabaseClient
      .from('strikes').select('*').order('created_at', { ascending: false });
    if (error) throw error;

    const now    = new Date();
    const active = strikes.filter(s => s.is_active && (s.intensity === 'permanent' || (s.block_until && new Date(s.block_until) > now)));
    const perms  = strikes.filter(s => s.intensity === 'permanent' && s.is_active);
    const { count: struckCount } = await supabaseClient
      .from('community_wallpapers').select('id', { count: 'exact', head: true }).eq('is_struck', true);

    document.getElementById('stat-total').textContent  = strikes.length;
    document.getElementById('stat-active').textContent = active.length;
    document.getElementById('stat-perm').textContent   = perms.length;
    document.getElementById('stat-struck').textContent = struckCount != null ? struckCount : '?';

    const badge = document.getElementById('active-strikes-badge');
    badge.textContent   = active.length;
    badge.style.display = active.length > 0 ? 'inline' : 'none';

    // Blocked creators list
    if (active.length === 0) {
      blockedList.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;padding:8px 0;">No creators are currently blocked. ✅</p>';
    } else {
      blockedList.innerHTML = active.map(s => {
        const untilStr = s.intensity === 'permanent'
          ? '🔴 <strong>Permanently Banned</strong>'
          : 'Until ' + new Date(s.block_until).toLocaleString();
        return '<div class="blocked-creator-row">' +
          '<div class="blocked-creator-info">' +
            '<span class="blocked-creator-name">👤 ' + escapeHtml(s.creator) + '</span>' +
            '<div class="blocked-creator-meta"><span>' + untilStr + '</span><span>· ' + escapeHtml(s.reason) + '</span></div>' +
          '</div>' +
          '<div class="blocked-creator-actions">' +
            '<span class="intensity-pill ' + s.intensity + '">' + s.intensity.toUpperCase() + '</span>' +
            '<button class="btn-revoke" onclick="revokeStrike(\'' + s.id + '\')">✓ Lift</button>' +
          '</div>' +
        '</div>';
      }).join('');
    }

    // Strike history table
    if (strikes.length === 0) {
      container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">🛡️</div><p>No strikes issued yet.</p></div>';
      return;
    }

    const rows = strikes.map(s => {
      const date    = new Date(s.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
      const expires = s.intensity === 'permanent'
        ? '<span style="color:#f55">Permanent</span>'
        : s.block_until
          ? new Date(s.block_until).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
          : '<span style="color:var(--text-secondary)">No block</span>';
      return '<tr>' +
        '<td><strong>' + escapeHtml(s.creator) + '</strong></td>' +
        '<td><span class="intensity-pill ' + s.intensity + '">' + s.intensity.toUpperCase() + '</span></td>' +
        '<td>' + escapeHtml(s.reason) + '</td>' +
        '<td>' + expires + '</td>' +
        '<td style="color:var(--text-secondary);font-size:0.8rem;">' + date + '</td>' +
        '<td>' + (s.is_active ? '🟢 Active' : '⚪ Revoked') + '</td>' +
        '<td>' + (s.is_active
          ? '<button class="btn-revoke" onclick="revokeStrike(\'' + s.id + '\')">✓ Revoke</button>'
          : '<span style="color:var(--text-secondary);font-size:0.75rem;">—</span>') + '</td>' +
      '</tr>';
    }).join('');

    container.innerHTML =
      '<table class="strikes-table">' +
        '<thead><tr>' +
          '<th>Creator</th><th>Intensity</th><th>Reason</th>' +
          '<th>Expires</th><th>Issued</th><th>Status</th><th>Action</th>' +
        '</tr></thead>' +
        '<tbody>' + rows + '</tbody>' +
      '</table>';

  } catch (err) {
    container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">❌</div><p>Failed: ' + err.message + '</p></div>';
  }
}

async function revokeStrike(strikeId) {
  if (!confirm('Lift this strike? The creator will be unblocked immediately.')) return;
  try {
    const { data: strike, error: fetchErr } = await supabaseClient
      .from('strikes').select('wallpaper_id').eq('id', strikeId).single();
    if (fetchErr) throw fetchErr;

    const { error } = await supabaseClient.from('strikes').update({ is_active: false }).eq('id', strikeId);
    if (error) throw error;

    if (strike && strike.wallpaper_id) {
      await supabaseClient.from('community_wallpapers')
        .update({ is_struck: false, strike_reason: null })
        .eq('id', strike.wallpaper_id);
    }

    showToast('Strike revoked. Creator unblocked.', 'success');
    fetchStrikes();
    fetchCommunityWallpapers();
  } catch (err) {
    showToast('Failed to revoke: ' + err.message, 'danger');
  }
}

async function updateStrikesBadge() {
  if (!supabaseClient) return;
  try {
    const now = new Date().toISOString();
    const { data } = await supabaseClient.from('strikes').select('id')
      .eq('is_active', true).or('intensity.eq.permanent,block_until.gt.' + now);
    const badge = document.getElementById('active-strikes-badge');
    if (data && data.length > 0) {
      badge.textContent = data.length;
      badge.style.display = 'inline';
    } else {
      badge.style.display = 'none';
    }
  } catch (_) {}
}

// =====================================================
// USER REPORTS MODERATION
// =====================================================

function parseReportDetails(pathText) {
  if (!pathText) return { title: 'Unknown', id: '', owner: 'Unknown', reason: 'Report', details: '' };
  
  const titleMatch = pathText.match(/Reported:\s*"([^"]+)"/i);
  const idMatch = pathText.match(/\(ID:\s*([^)]+)\)/i);
  const ownerMatch = pathText.match(/by owner\s*([^\.]+)\./i);
  const reasonMatch = pathText.match(/Reason:\s*([^.]+)\./i);
  const detailsMatch = pathText.match(/Details:\s*(.*)$/i);

  return {
    title: titleMatch ? titleMatch[1] : 'Unknown Wallpaper',
    id: idMatch ? idMatch[1] : '',
    owner: ownerMatch ? ownerMatch[1] : 'Unknown',
    reason: reasonMatch ? reasonMatch[1] : 'General Report',
    details: detailsMatch ? detailsMatch[1] : ''
  };
}

function escapeJSString(str) {
  if (!str) return '';
  return str.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

async function fetchReports() {
  const container = document.getElementById('reports-table-container');
  if (!supabaseClient) {
    container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">❌</div><p>Supabase client is not initialized. Please verify your connection settings in the Storage Settings tab.</p></div>';
    return;
  }
  
  container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">⏳</div><p>Loading reports...</p></div>';
  console.log('Fetching reports from site_analytics table using Supabase:', settings.supabaseUrl);

  try {
    const { data: events, error } = await supabaseClient
      .from('site_analytics')
      .select('*')
      .eq('event_type', 'wallpaper_report')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!events || events.length === 0) {
      container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">🛡️</div><p>No reports logged yet.</p></div>';
      return;
    }

    // Batch fetch community wallpaper details for the reported IDs to support preview
    const wpIds = [...new Set(events.map(e => parseReportDetails(e.path).id).filter(id => id))];
    let wallpapersMap = {};
    if (wpIds.length > 0) {
      try {
        const { data: wpData } = await supabaseClient
          .from('community_wallpapers')
          .select('id, file_url, is_video, thumbnail_url, creator')
          .in('id', wpIds);
        if (wpData) {
          wpData.forEach(wp => {
            wallpapersMap[wp.id] = wp;
          });
        }
      } catch (dbErr) {
        console.warn('Failed to batch fetch wallpaper details for reports preview:', dbErr);
      }
    }

    const rows = events.map(e => {
      const parsed = parseReportDetails(e.path);
      const wpDetails = wallpapersMap[parsed.id];
      const date = new Date(e.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      const reporter = e.session_id ? e.session_id.replace(/_/g, '@') : 'guest';
      
      const isDeleted = !wpDetails;
      const fileUrl = wpDetails ? wpDetails.file_url : '';
      const isVideo = wpDetails ? wpDetails.is_video : false;
      const thumbUrl = wpDetails ? wpDetails.thumbnail_url : 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="100" height="100"%3E%3C/svg%3E';
      const creator = wpDetails ? wpDetails.creator : parsed.owner;

      const reviewBtnHtml = isDeleted 
        ? `<button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.75rem; opacity: 0.5; cursor: not-allowed;" disabled>👁️ Review</button>`
        : `<button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; background: linear-gradient(135deg, #00c2ff, #c084fc); border: none; color: #000;" onclick="openPreviewModal('${fileUrl}', ${isVideo}, '${escapeJSString(parsed.title)}', '${escapeJSString(parsed.details)}')">👁️ Review</button>`;

      const strikeBtnHtml = isDeleted
        ? `<button class="btn btn-warning" style="padding: 6px 12px; font-size: 0.75rem; opacity: 0.5; cursor: not-allowed;" disabled>⚠️ Strike</button>`
        : `<button class="btn btn-warning" style="padding: 6px 12px; font-size: 0.75rem; background: #f79009; border: none; color: #fff;" onclick="openStrikeModal('${parsed.id}', '${escapeJSString(creator)}', '${escapeJSString(parsed.title)}', '${fileUrl}', '${thumbUrl}', '${e.id}')">⚠️ Strike</button>`;

      const titleHtml = isDeleted
        ? `<div style="font-weight: 600; color: #7f8c8d;">${escapeHtml(parsed.title)} <span style="font-size: 0.75rem; font-weight: normal; color: #e74c3c;">(Deleted)</span></div>`
        : `<div style="font-weight: 600; color: #fff;">${escapeHtml(parsed.title)}</div>`;

      return `<tr>
        <td>
          <div style="display: flex; align-items: center; gap: 10px;">
            <img src="${thumbUrl}" style="width: 50px; height: 30px; object-fit: cover; border-radius: 4px; border: 1px solid rgba(255,255,255,0.08);" onerror="this.src='data:image/svg+xml,%3Csvg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'30\\'%3E%3Crect width=\\'100%25\\' height=\\'100%25\\' fill=\\'%23111116\\'/%3E%3C/svg%3E'" />
            <div>
              ${titleHtml}
              <div style="font-size: 0.72rem; color: var(--text-muted); font-family: monospace;">ID: ${parsed.id}</div>
            </div>
          </div>
        </td>
        <td><span class="badge" style="background: rgba(168, 85, 247, 0.1); color: #c084fc; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px;">👤 ${escapeHtml(creator)}</span></td>
        <td><span style="font-family: monospace; font-size: 0.8rem; color: #a1a1aa;">${escapeHtml(reporter)}</span></td>
        <td><span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #f87171; font-size: 0.75rem; padding: 4px 8px; border-radius: 4px;">${escapeHtml(parsed.reason)}</span></td>
        <td style="max-width: 200px; white-space: normal; word-break: break-word; color: #d4d4d8; font-size: 0.85rem;">${escapeHtml(parsed.details || 'None')}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${date}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${reviewBtnHtml}
            ${strikeBtnHtml}
            <button class="btn btn-danger" style="padding: 6px 12px; font-size: 0.75rem; background: #d92d20;" onclick="deleteReportedWallpaper('${parsed.id}', '${e.id}', '${fileUrl}', '${thumbUrl}')">🗑️ Delete</button>
            <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="dismissReport('${e.id}')">✓ Dismiss</button>
          </div>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="strikes-table" style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr>
            <th>Wallpaper</th>
            <th>Owner/Creator</th>
            <th>Reporter</th>
            <th>Reason</th>
            <th>Details</th>
            <th>Date</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;

  } catch (err) {
    console.error('Failed to fetch reports:', err);
    container.innerHTML = `<div class="strikes-empty"><div class="empty-icon">❌</div><p>Failed to fetch reports: ${err.message}</p></div>`;
  }
}
window.fetchReports = fetchReports;

function resetSettingsToDefault() {
  if (confirm('Are you sure you want to reset all settings to defaults? This will clear all custom database and R2 storage configurations.')) {
    localStorage.removeItem('basic_wallpaper_admin_settings');
    showToast('Settings reset to defaults. Reloading...', 'success');
    setTimeout(() => {
      location.reload();
    }, 1000);
  }
}
window.resetSettingsToDefault = resetSettingsToDefault;

async function deleteReportedWallpaper(wpId, reportId, fileUrl = null, thumbnailUrl = null) {
  if (!confirm('Are you sure you want to permanently delete this wallpaper from the library? This cannot be undone.')) return;
  try {
    showToast('Deleting wallpaper...', 'warning');

    // 1. Delete DB record and associated files from storage
    await executeWallpaperDeletion(wpId, fileUrl, thumbnailUrl);

    // 2. Delete the report event from site_analytics so it clears
    const { error: deleteReportErr } = await supabaseClient
      .from('site_analytics')
      .delete()
      .eq('id', reportId);

    if (deleteReportErr) throw deleteReportErr;

    showToast('Wallpaper and files deleted successfully.', 'success');
    fetchReports();
  } catch (err) {
    showToast(`Failed to delete wallpaper: ${err.message}`, 'error');
  }
}
window.deleteReportedWallpaper = deleteReportedWallpaper;

async function dismissReport(reportId) {
  if (!confirm('Dismiss this report? This will remove the report flag.')) return;
  try {
    showToast('Dismissing report...', 'warning');

    const { error } = await supabaseClient
      .from('site_analytics')
      .delete()
      .eq('id', reportId);

    if (error) throw error;

    showToast('Report dismissed.', 'success');
    fetchReports();
  } catch (err) {
    showToast(`Failed to dismiss: ${err.message}`, 'error');
  }
}
window.dismissReport = dismissReport;

async function fetchAppeals() {
  const container = document.getElementById('appeals-table-container');
  if (!supabaseClient) {
    container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">❌</div><p>Supabase client is not initialized. Please verify your connection settings in the Storage Settings tab.</p></div>';
    return;
  }
  
  container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">⏳</div><p>Loading appeals...</p></div>';
  console.log('Fetching appeals from appeals table using Supabase:', settings.supabaseUrl);

  try {
    const { data: appeals, error } = await supabaseClient
      .from('appeals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (error) {
      if (error.code === '42P01' || error.message.includes('relation "appeals" does not exist')) {
        container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">ℹ️</div><p>Appeals table does not exist in your Supabase database. Please create it to start receiving recovery appeals.</p></div>';
        return;
      }
      throw error;
    }

    if (!appeals || appeals.length === 0) {
      container.innerHTML = '<div class="strikes-empty"><div class="empty-icon">✉️</div><p>No pending creator appeals.</p></div>';
      
      const badge = document.getElementById('pending-appeals-badge');
      if (badge) badge.style.display = 'none';
      return;
    }

    const badge = document.getElementById('pending-appeals-badge');
    if (badge) {
      badge.textContent = appeals.length;
      badge.style.display = 'inline-block';
    }

    window.currentAppealsList = appeals;
    const rows = appeals.map(a => {
      const date = new Date(a.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      return `<tr>
        <td><span style="font-weight: 600; color: #fff;">👤 ${escapeHtml(a.creator)}</span></td>
        <td>
          <a href="mailto:${escapeHtml(a.email)}?subject=Basic%20Wallpaper%20Appeal%20Response" style="font-family: monospace; font-size: 0.85rem; color: #3b82f6; text-decoration: underline;">
            ✉️ ${escapeHtml(a.email || 'N/A')}
          </a>
        </td>
        <td>
          <span class="badge" style="background: rgba(239, 68, 68, 0.1); color: #f87171; border: 1px solid rgba(239, 68, 68, 0.2); text-transform: uppercase; font-size: 0.72rem; padding: 4px 8px; border-radius: 4px;">
            ${escapeHtml(a.ban_type)}
          </span>
        </td>
        <td style="max-width: 400px; white-space: normal; word-break: break-word; color: #d4d4d8; font-size: 0.85rem; line-height: 1.4;">${escapeHtml(a.appeal_text)}</td>
        <td style="color: var(--text-muted); font-size: 0.8rem;">${date}</td>
        <td>
          <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem; background: #3b82f6; border: none; color: #fff; font-weight: 600;" onclick="openAppealModal('${a.id}')">✉️ Respond</button>
        </td>
      </tr>`;
    }).join('');

    container.innerHTML = `
      <table class="strikes-table" style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr>
            <th>Creator</th>
            <th>Email</th>
            <th>Ban Type</th>
            <th>Reason / Appeal Text</th>
            <th>Date Submitted</th>
            <th>Action</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;

  } catch (err) {
    console.error('Failed to fetch appeals:', err);
    container.innerHTML = `<div class="strikes-empty"><div class="empty-icon">❌</div><p>Failed to fetch appeals: ${err.message}</p></div>`;
  }
}
window.fetchAppeals = fetchAppeals;

function openAppealModal(appealId) {
  const appeal = window.currentAppealsList.find(a => a.id === appealId);
  if (!appeal) return;

  document.getElementById('appeal-modal-creator').textContent = appeal.creator;
  document.getElementById('appeal-modal-bantype').textContent = appeal.ban_type;
  document.getElementById('appeal-modal-email').textContent = appeal.email || 'N/A';
  document.getElementById('appeal-modal-text').textContent = appeal.appeal_text;
  
  // Set up mailto link
  const emailSubject = encodeURIComponent("Basic Wallpaper - Suspension Appeal Update");
  const emailBody = encodeURIComponent(`Hello ${appeal.creator},\n\nWe have reviewed your appeal for suspension.\n\n[Moderator Response here]\n\nBest regards,\nBasic Wallpaper Moderation Team`);
  document.getElementById('appeal-modal-mailto').href = `mailto:${appeal.email || ''}?subject=${emailSubject}&body=${emailBody}`;

  // Default response notes
  document.getElementById('appeal-response-notes').value = '';

  // Wire up action buttons
  const btnApprove = document.getElementById('btn-approve-appeal');
  const btnReject = document.getElementById('btn-reject-appeal');

  btnApprove.onclick = () => handleAppealModalAction(appeal, 'approved');
  btnReject.onclick = () => handleAppealModalAction(appeal, 'rejected');

  document.getElementById('appeal-modal').classList.add('active');
}
window.openAppealModal = openAppealModal;

function closeAppealModal() {
  document.getElementById('appeal-modal').classList.remove('active');
}
window.closeAppealModal = closeAppealModal;

async function handleAppealModalAction(appeal, action) {
  const notesInput = document.getElementById('appeal-response-notes').value.trim();
  const notes = notesInput || (action === 'approved' 
    ? 'Appeal approved. Your account has been recovered.' 
    : 'Appeal rejected. The ban remains active.');

  if (!confirm(`Are you sure you want to ${action === 'approved' ? 'approve and recover the account' : 'reject'} this appeal?`)) {
    return;
  }

  try {
    showToast(`${action === 'approved' ? 'Approving' : 'Rejecting'} appeal...`, 'warning');
    
    // 1. Update appeal status
    const { error: appealError } = await supabaseClient
      .from('appeals')
      .update({ status: action })
      .eq('id', appeal.id);
      
    if (appealError) throw appealError;
    
    // 2. Update strike notes and status
    const strikeUpdates = { notes: notes };
    if (action === 'approved') {
      strikeUpdates.is_active = false;
    }
    
    const { error: strikeError } = await supabaseClient
      .from('strikes')
      .update(strikeUpdates)
      .eq('id', appeal.strike_id);
        
    if (strikeError) throw strikeError;

    // 3. Compose email templates for confirmation
    const emailSubject = encodeURIComponent(action === 'approved' ? 'Appeal Approved - Basic Wallpaper' : 'Appeal Rejected - Basic Wallpaper');
    const emailBody = encodeURIComponent(`Hello ${appeal.creator},\n\nWe have reviewed your appeal.\n\nStatus: ${action.toUpperCase()}\nNotes: ${notes}\n\nBest regards,\nBasic Wallpaper Team`);
    
    showToast(`Appeal ${action}!`, "success");
    
    // Open email client with prefilled template automatically
    if (appeal.email) {
      window.open(`mailto:${appeal.email}?subject=${emailSubject}&body=${emailBody}`, '_blank');
    }

    closeAppealModal();
    fetchAppeals();
    updateAppealsBadge();
  } catch (err) {
    console.error("Error executing appeal action:", err);
    showToast(`Failed to execute action: ${err.message}`, 'danger');
  }
}
window.handleAppealModalAction = handleAppealModalAction;

async function updateAppealsBadge() {
  if (!supabaseClient) return;
  try {
    const { count, error } = await supabaseClient
      .from('appeals')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'pending');
    
    const badge = document.getElementById('pending-appeals-badge');
    if (!error && badge) {
      if (count > 0) {
        badge.textContent = count;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {
    console.warn("Could not query appeals count for badge:", e);
  }
}
window.updateAppealsBadge = updateAppealsBadge;

async function sendSystemNotification() {
  const titleInput = document.getElementById('notif-title');
  const messageInput = document.getElementById('notif-message');

  const title = titleInput.value.trim();
  const message = messageInput.value.trim();

  if (!title || !message) {
    showToast('Please fill out both notification title and message.', 'danger');
    return;
  }

  if (!supabaseClient) {
    showToast('Supabase client is not connected. Check your settings.', 'danger');
    return;
  }

  try {
    showToast('Broadcasting system notification...', 'warning');

    const { data, error } = await supabaseClient
      .from('system_notifications')
      .insert([{ title, message }]);

    if (error) throw error;

    showToast('Notification broadcast sent successfully!', 'success');
    titleInput.value = '';
    messageInput.value = '';
    fetchNotifications();
  } catch (err) {
    console.error('Failed to broadcast notification:', err);
    showToast(`Failed to broadcast: ${err.message}`, 'danger');
  }
}
window.sendSystemNotification = sendSystemNotification;

async function revokeAllNotifications() {
  const confirmRevoke = confirm('Are you sure you want to revoke (delete) all sent system notifications? This will remove them from all desktop app installations as well.');
  if (!confirmRevoke) return;

  if (!supabaseClient) {
    showToast('Supabase client is not connected. Check your settings.', 'danger');
    return;
  }

  try {
    showToast('Revoking all notifications...', 'warning');

    const { data, error } = await supabaseClient
      .from('system_notifications')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000');

    if (error) throw error;

    showToast('All system notifications revoked successfully!', 'success');
    fetchNotifications();
  } catch (err) {
    console.error('Failed to revoke notifications:', err);
    showToast(`Failed to revoke: ${err.message}`, 'danger');
  }
}
window.revokeAllNotifications = revokeAllNotifications;

async function fetchNotifications() {
  const container = document.getElementById('notifications-list-container');
  if (!container) return;

  if (!supabaseClient) {
    container.innerHTML = '<div style="color: #ef4444; font-size: 0.9rem;">Supabase client not connected.</div>';
    return;
  }

  try {
    container.innerHTML = '<div style="color: #a1a1aa; font-size: 0.9rem;">Loading active notifications...</div>';

    const { data, error } = await supabaseClient
      .from('system_notifications')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) throw error;

    if (!data || data.length === 0) {
      container.innerHTML = '<div style="color: #a1a1aa; font-size: 0.9rem; text-align: center; padding: 20px;">No active system notifications broadcasted.</div>';
      return;
    }

    const rows = data.map(notif => {
      const date = new Date(notif.created_at).toLocaleString();
      return `
        <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
          <td style="padding: 12px 8px; color: #fff; font-weight: 600; font-size: 0.9rem;">${escapeHtml(notif.title)}</td>
          <td style="padding: 12px 8px; color: #d4d4d8; font-size: 0.85rem; max-width: 300px; white-space: normal; word-break: break-word; line-height: 1.4;">${escapeHtml(notif.message)}</td>
          <td style="padding: 12px 8px; color: #a1a1aa; font-size: 0.8rem; white-space: nowrap;">${date}</td>
          <td style="padding: 12px 8px; text-align: right;">
            <button class="btn" style="padding: 6px 12px; font-size: 0.75rem; background: rgba(239, 68, 68, 0.1); border: 1px solid rgba(239, 68, 68, 0.3); color: #ef4444; font-weight: 600; cursor: pointer; border-radius: 4px; transition: all 0.2s;" 
                    onclick="deleteNotification('${notif.id}')"
                    onmouseover="this.style.background='rgba(239, 68, 68, 0.2)'"
                    onmouseout="this.style.background='rgba(239, 68, 68, 0.1)'">
              🗑️ Revoke
            </button>
          </td>
        </tr>
      `;
    }).join('');

    container.innerHTML = `
      <div style="overflow-x: auto;">
        <table style="width: 100%; border-collapse: collapse; text-align: left;">
          <thead>
            <tr style="border-bottom: 2px solid rgba(255,255,255,0.1); color: #a1a1aa; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.05em;">
              <th style="padding: 8px;">Title</th>
              <th style="padding: 8px;">Message</th>
              <th style="padding: 8px;">Created At</th>
              <th style="padding: 8px; text-align: right;">Action</th>
            </tr>
          </thead>
          <tbody>
            ${rows}
          </tbody>
        </table>
      </div>
    `;
  } catch (err) {
    console.error('Failed to fetch notifications:', err);
    container.innerHTML = `<div style="color: #ef4444; font-size: 0.9rem;">Failed to load notifications: ${err.message}</div>`;
  }
}
window.fetchNotifications = fetchNotifications;

async function deleteNotification(id) {
  const confirmDelete = confirm('Are you sure you want to revoke this specific system notification?');
  if (!confirmDelete) return;

  if (!supabaseClient) {
    showToast('Supabase client is not connected.', 'danger');
    return;
  }

  try {
    showToast('Revoking notification...', 'warning');

    const { error } = await supabaseClient
      .from('system_notifications')
      .delete()
      .eq('id', id);

    if (error) throw error;

    showToast('Notification revoked successfully!', 'success');
    fetchNotifications();
  } catch (err) {
    console.error('Failed to revoke notification:', err);
    showToast(`Failed to revoke: ${err.message}`, 'danger');
  }
}
window.deleteNotification = deleteNotification;

async function professionalizeNotification() {
  const titleInput = document.getElementById('notif-title');
  const messageInput = document.getElementById('notif-message');

  const title = titleInput.value.trim();
  const message = messageInput.value.trim();

  if (!message) {
    showToast('Please type a message in the Message Body first.', 'warning');
    return;
  }

  const apiKey = settings.geminiApiKey;
  if (!apiKey) {
    showToast('Gemini API key is not configured. Go to Storage Settings to set it.', 'danger');
    return;
  }

  try {
    showToast('Professionalizing message with AI...', 'warning');

    const promptText = `Rewrite the following notification title and message to sound highly professional, polite, concise, and clear for a desktop software application notification. Do not add any conversational remarks, markdown headers, or chatty prefix/suffix. Just output the rewritten result in JSON format with keys "title" and "message".

Original Title: ${title || "System Update"}
Original Message: ${message}`;

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: promptText
          }]
        }],
        generationConfig: {
          responseMimeType: "application/json"
        }
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error: ${response.statusText}`);
    }

    const result = await response.json();
    const responseText = result.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!responseText) {
      throw new Error("No response content from Gemini API.");
    }

    const data = JSON.parse(responseText.trim());
    if (data.title) {
      titleInput.value = data.title;
    }
    if (data.message) {
      messageInput.value = data.message;
    }

    showToast('Notification text professionalized successfully!', 'success');
  } catch (err) {
    console.error('Failed to professionalize text:', err);
    showToast(`AI professionalizing failed: ${err.message}`, 'danger');
  }
}
window.professionalizeNotification = professionalizeNotification;



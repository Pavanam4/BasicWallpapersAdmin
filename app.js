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
let cursorUploadDestination = 'r2'; // cursor upload destination
let uploadQueue = [];
let isUploading = false;
let communityWallpapers = [];

// Cloudflare Worker URL — all R2 uploads go through this
const WORKER_URL = 'https://solitary-sound-f6ff.pavanam926.workers.dev';

// Default credentials based on WPF app configuration
const DEFAULT_SETTINGS = {
  supabaseUrl: 'https://bvwvimqzlzknupxbnqco.supabase.co',
  supabaseKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImJ2d3ZpbXF6bHprbnVweGJucWNvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4NjE4MDM4OSwiZXhwIjoyMTAxNzU2Mzg5fQ._VjRoRycgZijQgKkD17y1avi9wZirjI0zcTxC2nIhWc',
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

function isServiceRoleKey(key) {
  try {
    if (!key || typeof key !== 'string') return false;
    const parts = key.split('.');
    if (parts.length < 2) return false;
    const payload = JSON.parse(atob(parts[1]));
    return payload && payload.role === 'service_role';
  } catch (e) {
    return false;
  }
}

// Load Settings from LocalStorage
function loadSettings() {
  const saved = localStorage.getItem('basic_wallpaper_admin_settings');
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      settings = { ...DEFAULT_SETTINGS, ...parsed };
      
      // Auto-migrate if legacy Supabase project URL was cached or not a service_role key
      if (!settings.supabaseUrl || settings.supabaseUrl.includes('msgncyczxaldboqqyjhw') || !isServiceRoleKey(settings.supabaseKey)) {
        console.log('[AdminPanel] Auto-migrating credentials to active Supabase service_role key');
        settings.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
        settings.supabaseKey = DEFAULT_SETTINGS.supabaseKey;
        localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
      }
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
  updateGeminiStatusBadge();
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
  updateGeminiStatusBadge();
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
  } else if (tabId === 'theme') {
    title.innerText = 'App Theme Change';
    sub.innerText = 'Real-time control over color palettes of all running client desktop applications';
  } else if (tabId === 'cursors') {
    title.innerText = 'Cursor Management & Upload';
    sub.innerText = 'Upload, preview, test, and moderate custom mouse cursor packs for Windows desktop clients';
    fetchAdminCursors();
  }
}

// Storage Destination Selector Logic
function setDestination(dest) {
  uploadDestination = dest;
  cursorUploadDestination = dest;
  localStorage.setItem('basic_wallpaper_upload_dest', dest);
  localStorage.setItem('basic_wallpaper_cursor_dest', dest);
  
  const supaBtn = document.getElementById('dest-supabase');
  const r2Btn = document.getElementById('dest-r2');
  const cursorR2Btn = document.getElementById('cursor-dest-r2');
  const cursorSupaBtn = document.getElementById('cursor-dest-supabase');

  if (dest === 'supabase') {
    if (supaBtn) supaBtn.classList.add('active');
    if (r2Btn) r2Btn.classList.remove('active');
    if (cursorSupaBtn) cursorSupaBtn.classList.add('active');
    if (cursorR2Btn) cursorR2Btn.classList.remove('active');
  } else {
    if (r2Btn) r2Btn.classList.add('active');
    if (supaBtn) supaBtn.classList.remove('active');
    if (cursorR2Btn) cursorR2Btn.classList.add('active');
    if (cursorSupaBtn) cursorSupaBtn.classList.remove('active');
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

// Smart Auto-Categorization Heuristic (Fallback & Initial Tagging)
function autoCategorize(title = '', tags = '', desc = '') {
  const text = `${title} ${tags} ${desc}`.toLowerCase();
  
  // Super Heroes
  if (/(spider-?man|batman|iron-?man|superman|avengers|marvel|dc\b|deadpool|wolverine|thor|hulk|captain america|venom|joker|thanos|flash\b|superhero|superheroes|gotham|justice league|hero)/i.test(text)) {
    return 'Super Heroes';
  }
  // Anime & Manga
  if (/(anime|manga|naruto|sasuke|goku|dragon ball|dbz|luffy|one piece|zoro|demon slayer|tanjiro|nezuko|rengoku|attack on titan|aot|eren|levi|mikasa|jujutsu kaisen|jjk|gojo|sukuna|itadori|chainsaw man|denji|makima|bleach|ichigo|death note|waifu|chibi|ghibli|genshin|honkai|evangelion|tokyo ghoul|sailor moon|cyberpunk edgerunners|arcane|jinx|solo leveling|sung jinwoo)/i.test(text)) {
    return 'Anime';
  }
  // Cars & Vehicles
  if (/(car|cars|supercar|hypercar|porsche|ferrari|lamborghini|bmw|audi|mercedes|amg|nissan|gtr|skyline|supra|toyota|mustang|ford|mclaren|bugatti|corvette|drift|racing|automotive|vehicle|motorcycle|superbike|yamaha|kawasaki|ducati)/i.test(text)) {
    return 'Cars';
  }
  // Games & Gaming
  if (/(game|gaming|gamer|cyberpunk 2077|witcher|valorant|elden ring|dark souls|halo|zelda|mario|pokemon|god of war|kratos|assassin'?s creed|overwatch|gta|grand theft auto|minecraft|fortnite|call of duty|cod|destiny|league of legends|lol\b|csgo|cs2|steam|playstation|xbox|nintendo|sekiro|resident evil|fallout)/i.test(text)) {
    return 'Games';
  }
  // Nature & Landscapes
  if (/(nature|forest|mountain|mountains|ocean|sea|beach|sunset|sunrise|river|lake|landscape|sky|clouds|rain|waterfall|space|galaxy|cosmos|nebula|stars|planet|earth|aurora|northern lights|flowers|tree|scenery|desert|snow|winter|autumn|spring|tropical)/i.test(text)) {
    return 'Nature';
  }
  
  return 'General';
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global callback for modal key save
let pendingAICallback = null;

function openGeminiKeyModal(callback = null) {
  pendingAICallback = callback;
  const modal = document.getElementById('gemini-key-modal');
  const input = document.getElementById('modal-gemini-key');
  if (input) input.value = settings.geminiApiKey || '';
  if (modal) modal.classList.add('active');
}

function closeGeminiKeyModal() {
  const modal = document.getElementById('gemini-key-modal');
  if (modal) modal.classList.remove('active');
  pendingAICallback = null;
}

function saveGeminiKeyModal() {
  const input = document.getElementById('modal-gemini-key');
  const key = (input ? input.value : '').trim();
  if (!key) {
    showToast('Please enter a valid Gemini API Key', 'warning');
    return;
  }
  settings.geminiApiKey = key;
  const settingsInput = document.getElementById('gemini-api-key');
  if (settingsInput) settingsInput.value = key;
  
  localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
  updateGeminiStatusBadge();
  showToast('Gemini API Key saved successfully!', 'success');
  
  const cb = pendingAICallback;
  closeGeminiKeyModal();
  if (typeof cb === 'function') {
    cb();
  }
}

function toggleModalKeyVisibility() {
  const input = document.getElementById('modal-gemini-key');
  if (input) {
    input.type = input.type === 'password' ? 'text' : 'password';
  }
}

function updateGeminiStatusBadge() {
  const badge = document.getElementById('gemini-status-badge');
  if (!badge) return;
  if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
    badge.innerHTML = '✨ Gemini AI Active';
    badge.style.background = 'linear-gradient(135deg, rgba(16, 185, 129, 0.2), rgba(127, 86, 217, 0.2))';
    badge.style.borderColor = 'rgba(74, 222, 128, 0.4)';
    badge.style.color = '#4ade80';
  } else {
    badge.innerHTML = '⚠️ Setup Gemini Key';
    badge.style.background = 'linear-gradient(135deg, rgba(234, 179, 8, 0.15), rgba(239, 68, 68, 0.15))';
    badge.style.borderColor = 'rgba(234, 179, 8, 0.4)';
    badge.style.color = '#facc15';
  }
}

function validateCategory(cat) {
  const allowed = ['General', 'Games', 'Anime', 'Cars', 'Nature', 'Super Heroes'];
  if (!cat) return null;
  const match = allowed.find(c => c.toLowerCase() === String(cat).trim().toLowerCase());
  return match || null;
}

// Call Google Gemini Multimodal Vision API for an image thumbnail or filename
async function callGeminiVisionAPI(imageDataUrl, filename) {
  const apiKey = (settings.geminiApiKey || '').trim();
  if (!apiKey) {
    throw new Error('MISSING_API_KEY');
  }

  let mimeType = '';
  let base64Data = '';
  
  if (imageDataUrl && typeof imageDataUrl === 'string' && imageDataUrl.startsWith('data:image/') && !imageDataUrl.includes('svg')) {
    try {
      const parts = imageDataUrl.split(',');
      if (parts.length === 2 && parts[1].length > 50) {
        mimeType = parts[0].split(';')[0].split(':')[1] || 'image/jpeg';
        base64Data = parts[1];
      }
    } catch (e) {
      console.warn('Could not parse thumbnail base64:', e);
    }
  }

  const promptText = `You are an elite wallpaper curator and tagger for a high-end 4K Desktop Live Wallpaper gallery.
Analyze this wallpaper preview along with its original filename: "${filename}".

Task:
Identify the character names, anime title, video game, vehicle make/model, landscape scenery, aesthetic style, lighting, colors, and mood.

Output the best metadata:
1. "title": A polished, clean, highly attractive Title in Title Case (e.g., "Cyberpunk Neon Samurai", "Eren Yeager Attack Titan", "Acheron Honkai Star Rail", "Midnight Porsche 911 GT3", "Tokyo Rainy Alleyway", "Goku Ultra Instinct"). Strip away raw hash numbers, resolution tags like 3840x2160 or 4k, file extensions, and boilerplate words like "wallpaper" or "live".
2. "category": Strictly choose ONE matching category from this list: ["General", "Games", "Anime", "Cars", "Nature", "Super Heroes"].
3. "tags": 6 to 10 relevant, lowercase, comma-separated keywords for user search (e.g. "anime, honkai star rail, acheron, dark, glowing, katana, 4k").
4. "description": A captivating, concise 1 to 2 sentence description highlighting the visual aesthetic, atmosphere, and mood.

Return ONLY a valid JSON object matching this exact structure with no markdown or code blocks:
{
  "title": "...",
  "category": "...",
  "tags": "...",
  "description": "..."
}`;

  // Assemble request parts: text prompt + inline image data if valid base64 is available
  const parts = [{ text: promptText }];
  if (base64Data && mimeType) {
    parts.push({
      inlineData: {
        mimeType: mimeType,
        data: base64Data
      }
    });
  }

  const models = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-3.7-flash', 'gemini-2.5-pro'];
  let lastError = null;

  for (const model of models) {
    try {
      let response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json"
          }
        })
      });

      // If rate limited (429), pause and retry once
      if (response.status === 429) {
        console.warn(`Model ${model} hit rate limit (429). Retrying after 2s backoff...`);
        await new Promise(r => setTimeout(r, 2000));
        response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts }],
            generationConfig: {
              responseMimeType: "application/json"
            }
          })
        });
      }

      if (response.ok) {
        const data = await response.json();
        const responseText = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!responseText) throw new Error('Empty AI response from Gemini');
        
        let parsed;
        try {
          parsed = JSON.parse(responseText.trim());
        } catch (e) {
          const cleaned = responseText.replace(/```json/gi, '').replace(/```/g, '').trim();
          parsed = JSON.parse(cleaned);
        }
        
        return {
          title: parsed.title || formatTitleFromName(filename),
          category: validateCategory(parsed.category) || autoCategorize(parsed.title || filename),
          tags: parsed.tags || '',
          description: parsed.description || ''
        };
      } else {
        const errText = await response.text();
        let errorDetail = `HTTP ${response.status}`;
        try {
          const errObj = JSON.parse(errText);
          if (errObj.error && errObj.error.message) {
            errorDetail = errObj.error.message;
          }
        } catch (e) {
          if (errText) errorDetail = errText.slice(0, 100);
        }
        console.warn(`Model ${model} returned error:`, errorDetail);
        lastError = new Error(errorDetail);
        
        // If API key is invalid, don't waste time trying all other models
        if (response.status === 400 && errorDetail.toLowerCase().includes('api key')) {
          break;
        }
      }
    } catch (e) {
      console.warn(`Error trying ${model}:`, e);
      lastError = e;
    }
  }

  throw lastError || new Error('Failed to generate with Gemini AI');
}

// Generate AI metadata for a single item in queue
async function generateAIMetadataForItem(itemId, silent = false) {
  const item = uploadQueue.find(i => i.id === itemId);
  if (!item) return false;

  if (!settings.geminiApiKey || !settings.geminiApiKey.trim()) {
    if (!silent) {
      openGeminiKeyModal(() => generateAIMetadataForItem(itemId));
    } else {
      // Offline fallback: intelligent rule-based categorization
      const fallbackCat = autoCategorize(item.title, item.tags, item.desc);
      item.category = fallbackCat;
      const catSelect = document.getElementById(`select-category-${item.id}`);
      if (catSelect) catSelect.value = fallbackCat;
    }
    return false;
  }

  const card = document.getElementById(`card-${item.id}`);
  const pill = document.getElementById(`ai-pill-${item.id}`);
  const btn = document.getElementById(`btn-ai-card-${item.id}`);

  if (card) card.classList.add('ai-processing');
  if (pill) {
    pill.className = 'ai-card-pill loading';
    pill.innerHTML = '<span class="ai-spin">✨</span> AI Analyzing...';
  }
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="ai-spin">⏳</span> Analyzing...';
  }

  try {
    // Wait for thumbnail promise if still generating
    if (item.thumbnailReady) {
      try {
        await Promise.race([
          item.thumbnailReady,
          new Promise(r => setTimeout(r, 4000))
        ]);
      } catch (e) {}
    }

    const aiResult = await callGeminiVisionAPI(item.thumbnailDataUrl, item.name);

    if (aiResult) {
      item.title = aiResult.title;
      item.category = aiResult.category;
      item.tags = aiResult.tags;
      item.desc = aiResult.description;

      // Update card UI inputs
      const titleInput = document.getElementById(`input-title-${item.id}`);
      const creatorInput = document.getElementById(`input-creator-${item.id}`);
      const catSelect = document.getElementById(`select-category-${item.id}`);
      const tagsInput = document.getElementById(`input-tags-${item.id}`);
      const descInput = document.getElementById(`input-desc-${item.id}`);

      if (titleInput) titleInput.value = item.title;
      if (catSelect) catSelect.value = item.category;
      if (tagsInput) tagsInput.value = item.tags;
      if (descInput) descInput.value = item.desc;

      if (pill) {
        pill.className = 'ai-card-pill done';
        pill.innerHTML = '✨ AI Generated';
      }

      if (!silent) {
        showToast(`✨ AI generated metadata for "${item.title}"`, 'success');
      }
      return true;
    }
    return false;
  } catch (err) {
    console.error('AI generation error for item:', item.name, err);
    
    // Graceful fallback on error so card still gets clean metadata
    const fallbackTitle = formatTitleFromName(item.name);
    const fallbackCat = autoCategorize(fallbackTitle, item.tags, item.desc);
    if (!item.title || item.title === item.name) item.title = fallbackTitle;
    item.category = fallbackCat;
    
    const titleInput = document.getElementById(`input-title-${item.id}`);
    const catSelect = document.getElementById(`select-category-${item.id}`);
    if (titleInput && !titleInput.value) titleInput.value = fallbackTitle;
    if (catSelect) catSelect.value = fallbackCat;

    if (pill) {
      pill.className = 'ai-card-pill';
      pill.innerHTML = '⚠️ AI Rate Limited (Click to retry)';
    }
    if (!silent) {
      if (err.message === 'MISSING_API_KEY') {
        openGeminiKeyModal(() => generateAIMetadataForItem(itemId));
      } else {
        showToast(`AI Notice: ${err.message}`, 'warning');
      }
    }
    return false;
  } finally {
    if (card) card.classList.remove('ai-processing');
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '✨ AI Auto-Fill';
    }
  }
}

// Generate AI metadata for ALL queue items with controlled pacing
async function generateAIMetadataForAll() {
  if (uploadQueue.length === 0) {
    showToast('Upload queue is empty. Drag or browse files first.', 'warning');
    return;
  }

  if (!settings.geminiApiKey || !settings.geminiApiKey.trim()) {
    openGeminiKeyModal(() => generateAIMetadataForAll());
    return;
  }

  const btnBulk = document.getElementById('btn-bulk-ai-all');
  const btnHeader = document.getElementById('btn-queue-header-ai');

  const origBulkText = btnBulk ? btnBulk.innerHTML : '';
  const origHeaderText = btnHeader ? btnHeader.innerHTML : '';

  if (btnBulk) {
    btnBulk.disabled = true;
    btnBulk.innerHTML = '<span class="ai-spin">✨</span> AI Processing...';
  }
  if (btnHeader) {
    btnHeader.disabled = true;
    btnHeader.innerHTML = '<span class="ai-spin">✨</span> AI Processing...';
  }

  showToast(`✨ Starting AI auto-fill for ${uploadQueue.length} wallpapers...`, 'info');

  let completed = 0;
  let successCount = 0;
  let failCount = 0;
  const total = uploadQueue.length;

  // Process sequentially with a small delay between requests to stay within free-tier rate limits
  for (let i = 0; i < uploadQueue.length; i++) {
    const item = uploadQueue[i];
    const ok = await generateAIMetadataForItem(item.id, true);
    if (ok) successCount++; else failCount++;
    completed++;
    
    if (btnBulk) btnBulk.innerHTML = `<span class="ai-spin">✨</span> AI Analyzing (${completed}/${total})...`;
    if (btnHeader) btnHeader.innerHTML = `<span class="ai-spin">✨</span> (${completed}/${total})...`;
    
    // 500ms delay between consecutive requests to avoid 429
    if (i < uploadQueue.length - 1) {
      await new Promise(r => setTimeout(r, 500));
    }
  }

  if (btnBulk) {
    btnBulk.disabled = false;
    btnBulk.innerHTML = origBulkText;
  }
  if (btnHeader) {
    btnHeader.disabled = false;
    btnHeader.innerHTML = origHeaderText;
  }

  if (successCount === total) {
    showToast(`✨ AI generated titles, tags & descriptions for all ${total} wallpapers!`, 'success');
  } else if (successCount > 0) {
    showToast(`✨ AI generated metadata for ${successCount}/${total} wallpapers (${failCount} fell back to smart tagging).`, 'success');
  } else {
    showToast(`⚠️ AI rate limit exceeded. Applied smart heuristic metadata. You can click retry anytime.`, 'warning');
  }
}

// Process Uploaded Files to Queue list
function handleUploadedFiles(files) {
  if (isUploading) {
    showToast('Cannot add files while uploads are in progress!', 'danger');
    return;
  }
  
  const filesArray = Array.from(files);
  const autoAIToggle = document.getElementById('auto-ai-toggle');
  const shouldAutoAI = autoAIToggle ? autoAIToggle.checked : true;
  
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
    
    // Generate thumbnail asynchronously
    item.thumbnailReady = generateThumbnail(item);

    // If Auto AI is enabled, trigger AI generation as soon as thumbnail is captured
    if (shouldAutoAI) {
      item.thumbnailReady.then(() => {
        generateAIMetadataForItem(item.id, true);
      });
    }
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
  name = name.replace(/[_\-\.]/g, ' ');
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
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
        <div class="card-ai-status" id="ai-status-${item.id}">
          <span class="ai-card-pill" id="ai-pill-${item.id}">✨ Ready for AI</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <button class="btn btn-ai-sm" id="btn-ai-card-${item.id}" onclick="generateAIMetadataForItem('${item.id}')" title="Analyze image with Gemini AI to generate title, category, tags & description">
            ✨ AI Auto-Fill
          </button>
          <button class="card-remove-btn" onclick="removeFromQueue('${item.id}')" title="Remove from Queue">&times;</button>
        </div>
      </div>
      
      <div class="input-row" style="margin-bottom: 12px;">
        <div class="input-group" style="flex: 2;">
          <label>Wallpaper Title</label>
          <input type="text" id="input-title-${item.id}" value="${escapeHtml(item.title)}" oninput="updateItemField('${item.id}', 'title', this.value)">
        </div>
        <div class="input-group" style="flex: 1;">
          <label>Creator</label>
          <input type="text" id="input-creator-${item.id}" value="${escapeHtml(item.creator)}" oninput="updateItemField('${item.id}', 'creator', this.value)">
        </div>
      </div>
      
      <div class="input-row" style="margin-bottom: 16px;">
        <div class="input-group" style="flex: 1;">
          <label>Category</label>
          <select id="select-category-${item.id}" style="background: #111116; color: #fff; border: 1px solid var(--border-panel); border-radius: 6px; padding: 10px; font-family: inherit; font-size: 14px; outline: none; transition: border-color 0.2s; color-scheme: dark;" onchange="updateItemField('${item.id}', 'category', this.value)">
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
          <select id="select-type-${item.id}" style="background: #111116; color: #fff; border: 1px solid var(--border-panel); border-radius: 6px; padding: 10px; font-family: inherit; font-size: 14px; outline: none; transition: border-color 0.2s; color-scheme: dark;" onchange="updateItemField('${item.id}', 'type', this.value); updateCardTypeBadge('${item.id}', this.value)">
            <option value="video" ${item.type === 'video' ? 'selected' : ''}>Live (Video)</option>
            <option value="image" ${item.type === 'image' ? 'selected' : ''}>4K Wallpaper (Picture)</option>
          </select>
        </div>
        <div class="input-group" style="flex: 1;">
          <label>Tags (separated by comma)</label>
          <input type="text" id="input-tags-${item.id}" value="${escapeHtml(item.tags)}" placeholder="e.g. dynamic, colorful" oninput="updateItemField('${item.id}', 'tags', this.value)">
        </div>
        <div class="input-group" style="flex: 2;">
          <label>Description</label>
          <input type="text" id="input-desc-${item.id}" value="${escapeHtml(item.desc)}" placeholder="Describe this wallpaper" oninput="updateItemField('${item.id}', 'desc', this.value)">
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
  if (!supabaseClient || !isServiceRoleKey(settings.supabaseKey)) {
    settings.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
    settings.supabaseKey = DEFAULT_SETTINGS.supabaseKey;
    localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
    if (typeof supabase !== 'undefined') {
      supabaseClient = supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
    }
  }
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
  if (!supabaseClient || !isServiceRoleKey(settings.supabaseKey)) {
    settings.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
    settings.supabaseKey = DEFAULT_SETTINGS.supabaseKey;
    localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
    if (typeof supabase !== 'undefined') {
      supabaseClient = supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
    }
  }
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
  if (!supabaseClient || !isServiceRoleKey(settings.supabaseKey)) {
    settings.supabaseUrl = DEFAULT_SETTINGS.supabaseUrl;
    settings.supabaseKey = DEFAULT_SETTINGS.supabaseKey;
    localStorage.setItem('basic_wallpaper_admin_settings', JSON.stringify(settings));
    if (typeof supabase !== 'undefined') {
      supabaseClient = supabase.createClient(settings.supabaseUrl, settings.supabaseKey);
    }
  }
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

    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
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


// App Theme Customizer Preset Definitions
const presets = {
  default: {
    accent: '#6c63ff',
    accentLight: '#9b95ff',
    bgDeep: '#0d0d0f',
    bgPanel: '#161618',
    bgCard: '#1e1e22',
    bgHover: '#26262c',
    textPrimary: '#f0f0f5',
    textSecondary: '#8888a0',
    border: '#2a2a33'
  },
  cyberpunk: {
    accent: '#ec4899',
    accentLight: '#f472b6',
    bgDeep: '#0a0512',
    bgPanel: '#120b24',
    bgCard: '#1c103a',
    bgHover: '#2a1a54',
    textPrimary: '#00ffff',
    textSecondary: '#a78bfa',
    border: '#ec4899'
  },
  emerald: {
    accent: '#00ff66',
    accentLight: '#55ff99',
    bgDeep: '#050c09',
    bgPanel: '#0a1612',
    bgCard: '#12251e',
    bgHover: '#1c382e',
    textPrimary: '#ffffff',
    textSecondary: '#8aa69d',
    border: '#00ff66'
  },
  midnight: {
    accent: '#2563eb',
    accentLight: '#60a5fa',
    bgDeep: '#020617',
    bgPanel: '#0f172a',
    bgCard: '#1e293b',
    bgHover: '#334155',
    textPrimary: '#f8fafc',
    textSecondary: '#94a3b8',
    border: '#334155'
  },
  sakura: {
    accent: '#fda4af',
    accentLight: '#fecdd3',
    bgDeep: '#0f050b',
    bgPanel: '#1a0d15',
    bgCard: '#2d1825',
    bgHover: '#3d2233',
    textPrimary: '#ffe4e6',
    textSecondary: '#f43f5e',
    border: '#e11d48'
  },
  sunset: {
    accent: '#f97316',
    accentLight: '#fdba74',
    bgDeep: '#0c0404',
    bgPanel: '#180a0a',
    bgCard: '#271212',
    bgHover: '#371a1a',
    textPrimary: '#ffedd5',
    textSecondary: '#f97316',
    border: '#f97316'
  },
  synthwave: {
    accent: '#06b6d4',
    accentLight: '#67e8f9',
    bgDeep: '#0f0212',
    bgPanel: '#1c0724',
    bgCard: '#2a0d36',
    bgHover: '#3d164d',
    textPrimary: '#f0abfc',
    textSecondary: '#a855f7',
    border: '#06b6d4'
  },
  amber: {
    accent: '#f59e0b',
    accentLight: '#fde68a',
    bgDeep: '#0c0904',
    bgPanel: '#181207',
    bgCard: '#261c0c',
    bgHover: '#362811',
    textPrimary: '#fef3c7',
    textSecondary: '#f59e0b',
    border: '#f59e0b'
  },
  crimson: {
    accent: '#ef4444',
    accentLight: '#fca5a5',
    bgDeep: '#0f0202',
    bgPanel: '#1c0505',
    bgCard: '#2d0a0a',
    bgHover: '#3e1111',
    textPrimary: '#fee2e2',
    textSecondary: '#ef4444',
    border: '#ef4444'
  }
};

function applyPreset() {
  const selected = document.getElementById('theme-preset').value;
  if (selected === 'custom') return;
  const p = presets[selected];
  if (!p) return;

  document.getElementById('color-accent').value = p.accent;
  document.getElementById('hex-accent').value = p.accent;
  document.getElementById('color-bg-deep').value = p.bgDeep;
  document.getElementById('hex-bg-deep').value = p.bgDeep;
  document.getElementById('color-bg-panel').value = p.bgPanel;
  document.getElementById('hex-bg-panel').value = p.bgPanel;
  document.getElementById('color-bg-card').value = p.bgCard;
  document.getElementById('hex-bg-card').value = p.bgCard;
}
window.applyPreset = applyPreset;

function resetThemeToDefault() {
  const presetSel = document.getElementById('theme-preset');
  if (presetSel) {
    presetSel.value = 'default';
    applyPreset();
    publishTheme();
  }
}
window.resetThemeToDefault = resetThemeToDefault;

function syncColorInput(id) {
  const hexVal = document.getElementById(`hex-${id}`).value;
  if (/^#[0-9A-F]{6}$/i.test(hexVal)) {
    document.getElementById(`color-${id}`).value = hexVal;
    markCustom();
  }
}
window.syncColorInput = syncColorInput;

// Ensure color pickers sync their HEX text inputs
document.addEventListener('DOMContentLoaded', () => {
  ['accent', 'bg-deep', 'bg-panel', 'bg-card'].forEach(id => {
    const picker = document.getElementById(`color-${id}`);
    const text = document.getElementById(`hex-${id}`);
    if (picker && text) {
      picker.addEventListener('input', () => {
        text.value = picker.value.toUpperCase();
      });
    }
  });
});

function markCustom() {
  const presetSel = document.getElementById('theme-preset');
  if (presetSel) presetSel.value = 'custom';
}
window.markCustom = markCustom;

async function publishTheme() {
  if (!supabaseClient) {
    showToast('Database not connected. Please save settings first.', 'danger');
    return;
  }

  const selected = document.getElementById('theme-preset').value;
  let themeObj = {};

  if (selected !== 'custom') {
    themeObj = { ...presets[selected] };
  } else {
    const accent = document.getElementById('color-accent').value;
    const bgDeep = document.getElementById('color-bg-deep').value;
    const bgPanel = document.getElementById('color-bg-panel').value;
    const bgCard = document.getElementById('color-bg-card').value;

    themeObj = {
      BgDeep: bgDeep,
      BgPanel: bgPanel,
      BgCard: bgCard,
      BgHover: adjustColorBrightness(bgCard, 10),
      Accent: accent,
      AccentLight: adjustColorBrightness(accent, 30),
      TextPrimary: '#F0F0F5',
      TextSecondary: '#8888A0',
      Border: adjustColorBrightness(bgCard, 20)
    };
  }

  const payload = {
    BgDeep: themeObj.bgDeep || themeObj.BgDeep,
    BgPanel: themeObj.bgPanel || themeObj.BgPanel,
    BgCard: themeObj.bgCard || themeObj.BgCard,
    BgHover: themeObj.bgHover || themeObj.BgHover,
    Accent: themeObj.accent || themeObj.Accent,
    AccentLight: themeObj.accentLight || themeObj.AccentLight,
    TextPrimary: themeObj.textPrimary || themeObj.TextPrimary,
    TextSecondary: themeObj.textSecondary || themeObj.TextSecondary,
    Border: themeObj.border || themeObj.Border
  };

  try {
    const { error } = await supabaseClient
      .from('app_config')
      .upsert({ key: 'app_theme', value: JSON.stringify(payload) });

    if (error) throw error;

    showToast('Theme published successfully! Running applications will update in real-time.', 'success');
  } catch (err) {
    console.error('Error publishing theme:', err.message);
    showToast(`Failed to publish theme: ${err.message}`, 'danger');
  }
}
window.publishTheme = publishTheme;

function adjustColorBrightness(hex, percent) {
  let R = parseInt(hex.substring(1, 3), 16);
  let G = parseInt(hex.substring(3, 5), 16);
  let B = parseInt(hex.substring(5, 7), 16);

  R = parseInt(R * (100 + percent) / 100);
  G = parseInt(G * (100 + percent) / 100);
  B = parseInt(B * (100 + percent) / 100);

  R = (R < 255) ? R : 255;
  G = (G < 255) ? G : 255;
  B = (B < 255) ? B : 255;

  const rHex = (R.toString(16).length === 1) ? "0" + R.toString(16) : R.toString(16);
  const gHex = (G.toString(16).length === 1) ? "0" + G.toString(16) : G.toString(16);
  const bHex = (B.toString(16).length === 1) ? "0" + B.toString(16) : B.toString(16);

  return "#" + rHex + gHex + bHex;
}

/* ==========================================================================
   CURSOR MANAGEMENT & UPLOAD MODULE
   ========================================================================== */
let adminCursorsList = [];

async function fetchAdminCursors() {
  const container = document.getElementById('admin-cursors-grid');
  if (!container) return;
  container.innerHTML = '<div style="color: #94a3b8; padding: 20px; grid-column: 1 / -1;">Loading cursor library...</div>';

  try {
    // 1. Fetch from local cursors-manifest.json
    const res = await fetch('cursors-manifest.json');
    if (res.ok) {
      const data = await res.json();
      adminCursorsList = data.cursors || [];
    } else {
      adminCursorsList = [];
    }

    // 1b. Merge local storage cached cursors
    try {
      const cached = JSON.parse(localStorage.getItem('basic_wallpaper_admin_cursors') || '[]');
      if (cached && cached.length > 0) {
        const existingIds = new Set(adminCursorsList.map(c => c.id));
        cached.forEach(item => {
          if (!existingIds.has(item.id)) {
            adminCursorsList.unshift(item);
          }
        });
      }
    } catch(e) {}

    // 2. Fetch from Supabase community_cursors table
    if (supabaseClient) {
      try {
        const { data: dbData, error } = await supabaseClient
          .from('community_cursors')
          .select('*')
          .order('created_at', { ascending: false });
        if (!error && dbData && dbData.length > 0) {
          const existingIds = new Set(adminCursorsList.map(c => c.id));
          dbData.forEach(item => {
            if (!existingIds.has(item.id)) {
              adminCursorsList.push({
                id: item.id,
                name: item.title,                          // community_cursors uses 'title'
                creator: item.creator || 'Community',
                cat: item.category || 'General',
                type: item.is_animated ? 'ani' : 'cur',
                desc: item.description || 'Custom cursor',
                file: item.file_url,                       // community_cursors uses 'file_url'
                created_at: item.created_at
              });
            }
          });
        }
      } catch(e) {
        console.warn('community_cursors fetch error:', e);
      }
    }

    renderAdminCursors(adminCursorsList);
  } catch (err) {
    console.error('Error fetching admin cursors:', err);
    renderAdminCursors(adminCursorsList);
  }
}

function filterAdminCursors() {
  const query = (document.getElementById('admin-cursor-search')?.value || '').toLowerCase();
  const cat = document.getElementById('admin-cursor-cat-filter')?.value || 'all';

  const filtered = adminCursorsList.filter(c => {
    const matchQuery = !query || c.name.toLowerCase().includes(query) || (c.desc && c.desc.toLowerCase().includes(query)) || (c.creator && c.creator.toLowerCase().includes(query));
    const matchCat = cat === 'all' || c.cat === cat;
    return matchQuery && matchCat;
  });

  renderAdminCursors(filtered);
}

function renderAdminCursors(list) {
  const container = document.getElementById('admin-cursors-grid');
  if (!container) return;

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px; color: #94a3b8; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.08); border-radius: 12px;">
        <div style="font-size: 2rem; margin-bottom: 8px;">🖱️</div>
        <div style="font-size: 1rem; font-weight: 600; color: #fff;">No custom cursors found</div>
        <div style="font-size: 0.85rem; margin-top: 4px;">Use the form above to upload your first cursor pack.</div>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(c => {
    const isImagePreviewable = /\.(png|webp|jpg|jpeg|svg)$/i.test(c.file || '');
    const isAnimated = /\.ani$/i.test(c.file || '') || c.type === 'ani';
    const fileExt = (c.type || (c.file || '').split('.').pop() || 'cur').toUpperCase();
    
    const previewContent = isImagePreviewable
      ? `<img src="${c.file}" alt="${c.name}" style="max-width:80px;max-height:80px;object-fit:contain;border-radius:6px;image-rendering:pixelated;" onerror="this.style.display='none';this.parentNode.querySelector('.fallback-icon').style.display='flex'"><div class="fallback-icon" style="display:none;flex-direction:column;align-items:center;gap:4px;"><span style="font-size:2rem;">${isAnimated ? '💫' : '🖱️'}</span><span style="font-size:0.65rem;color:#a482f4;font-weight:700;padding:3px 8px;background:rgba(127,86,217,0.2);border-radius:8px;">${fileExt}</span></div>`
      : `<div style="display:flex;flex-direction:column;align-items:center;gap:6px;"><span style="font-size:2.2rem;">${isAnimated ? '💫' : '🖱️'}</span><span style="font-size:0.65rem;color:#a482f4;font-weight:700;padding:3px 8px;background:rgba(127,86,217,0.2);border-radius:8px;">${fileExt}</span></div>`;

    return `
    <div class="glass-panel" style="padding: 16px; display: flex; flex-direction: column; justify-content: space-between; position: relative;">
      <div>
        <div style="width: 100%; height: 110px; background: radial-gradient(circle at center, rgba(127, 86, 217, 0.15), rgba(10, 8, 20, 0.9)); border-radius: 8px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 4px; cursor: url('${c.file}'), auto; border: 1px solid rgba(255,255,255,0.08); transition: border-color 0.2s; overflow: hidden;" onmouseover="this.style.borderColor='#7F56D9'" onmouseout="this.style.borderColor='rgba(255,255,255,0.08)'">
          ${previewContent}
          <span style="font-size: 0.62rem; color: #64748b; margin-top: 2px;">Hover to test cursor</span>
        </div>

        <div style="margin-top: 12px;">
          <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 4px;">
            <h4 style="font-size: 0.95rem; font-weight: 700; color: #fff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;" title="${c.name}">${c.name}</h4>
            <span style="background: rgba(127, 86, 217, 0.2); color: #c4b5fd; font-size: 0.65rem; font-weight: 700; padding: 2px 6px; border-radius: 10px; text-transform: uppercase;">.${c.type || fileExt.toLowerCase()}</span>
          </div>
          <div style="font-size: 0.78rem; color: #94a3b8; margin-bottom: 6px;">By ${c.creator || 'Community'} • <span style="color: #7F56D9;">${c.cat || 'General'}</span></div>
          <div style="font-size: 0.78rem; color: #cbd5e1; line-height: 1.4; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${c.desc || 'Custom mouse cursor pack'}</div>
        </div>
      </div>

      <div style="display: flex; gap: 6px; margin-top: 14px; flex-wrap: wrap;">
        <button class="btn" onclick="testWebCursor('${c.file}', '${(c.name || '').replace(/'/g, "\\'")}')" style="flex: 1; padding: 7px; font-size: 0.75rem; font-weight: 600; background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.1); color: #fff; border-radius: 6px; cursor: pointer;">
          👁️ Test
        </button>
        <button class="btn" onclick="copyCursorUrl('${c.file}')" style="flex: 1; padding: 7px; font-size: 0.75rem; font-weight: 600; background: rgba(127, 86, 217, 0.15); border: 1px solid rgba(127, 86, 217, 0.3); color: #c4b5fd; border-radius: 6px; cursor: pointer;">
          🔗 Link
        </button>
        <button class="btn" onclick="deleteAdminCursor('${c.id}')" style="padding: 7px 10px; font-size: 0.75rem; font-weight: 600; background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.3); color: #f87171; border-radius: 6px; cursor: pointer;">
          🗑️
        </button>
      </div>
    </div>
  `}).join('');
}

let cursorBatchQueue = [];

function handleAdminCursorFileSelect(files) {
  if (!files || files.length === 0) return;

  const validExts = ['cur', 'ani', 'png', 'webp', 'svg', 'jpg', 'jpeg'];
  const creator = document.getElementById('cursor-creator')?.value.trim() || 'Pavan Am';
  const cat = document.getElementById('cursor-category')?.value || 'Minimal';
  const desc = document.getElementById('cursor-desc')?.value.trim() || 'Custom mouse cursor pack';

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const ext = file.name.split('.').pop().toLowerCase();
    if (!validExts.includes(ext)) continue;

    const cleanTitle = file.name.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ');

    cursorBatchQueue.push({
      file,
      name: cleanTitle,
      creator,
      cat,
      type: ext,
      desc,
      status: 'pending',
      progress: 0
    });
  }

  renderCursorQueue();
}

function renderCursorQueue() {
  const container = document.getElementById('cursor-queue-container');
  const listEl = document.getElementById('cursor-queue-list');
  const countEl = document.getElementById('cursor-queue-count');
  const btnCountEl = document.getElementById('cursor-queue-btn-count');

  if (!container || !listEl) return;

  if (cursorBatchQueue.length === 0) {
    container.style.display = 'none';
    return;
  }

  container.style.display = 'block';
  if (countEl) countEl.innerText = cursorBatchQueue.length;
  if (btnCountEl) btnCountEl.innerText = cursorBatchQueue.length;

  listEl.innerHTML = cursorBatchQueue.map((item, idx) => `
    <div style="background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.08); border-radius: 8px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px;">
      <div style="display: flex; align-items: center; gap: 10px; flex: 1; overflow: hidden;">
        <span style="font-size: 1.2rem;">🖱️</span>
        <div style="overflow: hidden;">
          <div style="font-size: 0.85rem; font-weight: 700; color: #fff; text-overflow: ellipsis; overflow: hidden; white-space: nowrap;">${item.name}</div>
          <div style="font-size: 0.72rem; color: #94a3b8;">.${item.type} • ${(item.file.size / 1024).toFixed(1)} KB • ${item.creator}</div>
        </div>
      </div>

      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="background: ${item.status === 'success' ? 'rgba(34,197,94,0.2)' : item.status === 'uploading' ? 'rgba(59,130,246,0.2)' : 'rgba(127, 86, 217, 0.2)'}; color: ${item.status === 'success' ? '#4ade80' : item.status === 'uploading' ? '#60a5fa' : '#c4b5fd'}; font-size: 0.65rem; font-weight: 700; padding: 2px 8px; border-radius: 10px; text-transform: uppercase;">${item.status}</span>
        <button onclick="removeCursorQueueItem(${idx})" style="background: none; border: none; color: #f87171; font-size: 0.9rem; cursor: pointer; padding: 2px 6px;">✕</button>
      </div>
    </div>
  `).join('');
}

function removeCursorQueueItem(idx) {
  cursorBatchQueue.splice(idx, 1);
  renderCursorQueue();
}

function setCursorDestination(dest) {
  setDestination(dest);
  showToast(`Cursor upload destination set to ${dest === 'r2' ? 'Cloudflare R2' : 'Supabase Storage'}`, 'info');
}

function clearCursorQueue() {
  cursorBatchQueue = [];
  renderCursorQueue();

  const f1 = document.getElementById('cursor-upload-file');
  const f2 = document.getElementById('cursor-folder-file');
  if (f1) f1.value = '';
  if (f2) f2.value = '';
}

async function uploadCursorFromAdmin() {
  const btn = document.getElementById('btn-upload-cursor');

  if (cursorBatchQueue.length === 0) {
    showToast('Please select at least one cursor file to upload.', 'warning');
    return;
  }

  const btnOriginalText = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = '⏳ Batch Uploading Cursors...';

  let successCount = 0;

  for (let i = 0; i < cursorBatchQueue.length; i++) {
    const item = cursorBatchQueue[i];
    item.status = 'uploading';
    renderCursorQueue();

    try {
      let publicUrl = '';
      const cleanFileName = `cursors/${Date.now()}_${item.file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

      if (cursorUploadDestination === 'supabase' && supabaseClient) {
        // Upload to Supabase Storage Bucket
        const { data, error } = await supabaseClient.storage
          .from(settings.supabaseWallpapersBucket || 'wallpapers')
          .upload(cleanFileName, item.file, { contentType: item.file.type || 'application/octet-stream' });

        if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);

        publicUrl = supabaseClient.storage
          .from(settings.supabaseWallpapersBucket || 'wallpapers')
          .getPublicUrl(cleanFileName).data.publicUrl;
      } else {
        // Upload to Cloudflare R2 via dedicated cursor worker
        // ⚠️  Deploy cursor-worker.js to Cloudflare then update this URL:
        const CURSOR_WORKER_URL = 'https://cursor-upload-worker.pavanam926.workers.dev';
        const formData = new FormData();
        formData.append('type', 'media');
        formData.append('filename', cleanFileName);
        formData.append('file', item.file);
        
        const resp = await fetch(CURSOR_WORKER_URL, { method: 'POST', body: formData });
        if (!resp.ok) throw new Error(`Cloudflare R2 upload failed: ${resp.statusText}`);
        const r2Data = await resp.json();
        // Use exact URL returned by worker — this is the real storage location
        publicUrl = r2Data.url;
        if (!publicUrl) throw new Error('Worker did not return a URL. Check R2 worker config.');
        console.log(`[Cursor Upload] File stored at: ${publicUrl}`);
      }

      const newCursor = {
        id: `cursor_${Date.now()}_${i}_${Math.random().toString(36).substring(2, 7)}`,
        name: item.name,
        creator: item.creator,
        cat: item.cat,
        type: item.type,
        desc: item.desc,
        file: publicUrl,
        created_at: new Date().toISOString()
      };

      // Insert into community_cursors table with correct schema (UUID auto-generated)
      try {
        if (supabaseClient) {
          const isAnimated = item.type === 'ani' || /\.ani$/i.test(publicUrl);
          const { error: insertErr } = await supabaseClient.from('community_cursors').insert([{
            title: item.name,                    // required TEXT NOT NULL
            creator: item.creator || 'Pavan Am', // required TEXT NOT NULL
            description: item.desc || '',
            category: item.cat || 'General',
            file_url: publicUrl,                 // required TEXT NOT NULL
            preview_emoji: isAnimated ? '💫' : '🖱️',
            is_animated: isAnimated,
            tags: item.cat || ''
          }]);
          if (insertErr) console.warn('Supabase insert error:', insertErr.message, insertErr.details);
        }
      } catch (dbErr) {
        console.warn('Supabase community_cursors insert error:', dbErr);
      }

      adminCursorsList.unshift(newCursor);
      // Persist to local storage cache so uploaded cursors are instantly saved
      try {
        localStorage.setItem('basic_wallpaper_admin_cursors', JSON.stringify(adminCursorsList));
      } catch(e) {}

      item.status = 'success';
      successCount++;
    } catch (err) {
      console.error(`Error uploading cursor ${item.name}:`, err);
      item.status = 'failed';
    }
  }

  renderAdminCursors(adminCursorsList);
  showToast(`Successfully batch uploaded ${successCount} cursor pack(s)!`, 'success');

  cursorBatchQueue = cursorBatchQueue.filter(item => item.status === 'failed');
  renderCursorQueue();

  btn.disabled = false;
  btn.innerHTML = btnOriginalText;
}

function deleteAdminCursor(id) {
  if (!confirm('Are you sure you want to delete this cursor from the library?')) return;

  adminCursorsList = adminCursorsList.filter(c => c.id !== id);
  renderAdminCursors(adminCursorsList);

  if (supabaseClient) {
    supabaseClient.from('cursors').delete().eq('id', id).catch(() => {});
  }

  showToast('Cursor deleted from library', 'info');
}

function copyCursorUrl(url) {
  navigator.clipboard.writeText(url).then(() => {
    showToast('Cursor download link copied to clipboard!', 'success');
  }).catch(() => {
    prompt('Copy cursor URL:', url);
  });
}

function testWebCursor(url, name) {
  const lbl = document.getElementById('lblActiveCursorName');
  if (lbl) lbl.innerText = name;

  const ext = (url.split('.').pop() || '').toLowerCase();

  // .ani files are NOT supported as CSS cursors in any browser — warn user
  if (ext === 'ani') {
    showToast(`⚠️ .ANI files cannot be used as web cursors. They work in Windows apps only. Try hovering the preview box instead.`, 'warning');
    return;
  }

  // Inject a page-wide <style> override that beats any CSS specificity
  let styleTag = document.getElementById('__cursor_override_style__');
  if (!styleTag) {
    styleTag = document.createElement('style');
    styleTag.id = '__cursor_override_style__';
    document.head.appendChild(styleTag);
  }
  styleTag.textContent = `
    *, *::before, *::after, body, html, button, a, input, select, textarea, [role] {
      cursor: url('${url}'), auto !important;
    }
  `;

  showToast(`🖱️ Cursor set to: ${name} — move your mouse to see it`, 'success');
}

function resetWebCursor() {
  const lbl = document.getElementById('lblActiveCursorName');
  if (lbl) lbl.innerText = 'Default Windows Arrow';

  const styleTag = document.getElementById('__cursor_override_style__');
  if (styleTag) styleTag.remove();

  document.body.style.cursor = 'default';
  showToast('Reset to default cursor', 'info');
}

// Expose AI Auto-Fill helpers to window
window.generateAIMetadataForItem = generateAIMetadataForItem;
window.generateAIMetadataForAll = generateAIMetadataForAll;
window.openGeminiKeyModal = openGeminiKeyModal;
window.closeGeminiKeyModal = closeGeminiKeyModal;
window.saveGeminiKeyModal = saveGeminiKeyModal;
window.toggleModalKeyVisibility = toggleModalKeyVisibility;
window.autoCategorize = autoCategorize;






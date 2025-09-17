import { credentialManager } from './utils/crypto-utils.js';
// crypto--encryption
//const credManager = new credentialManager();
//credManager.initialize();

// State management
let state = {
  status: 'idle', // idle, checking, connected, needs_login, error, network_down
  lastError: null,
  lastLoginAt: null,
  nextRenewAt: null,
  isConnected: false,
  retryCount: 0
};

// Constants
const PORTAL_URL = 'https://agnigarh.iitg.ac.in:1442/login?';
const PORTAL_BASE = 'https://agnigarh.iitg.ac.in:1442';
const SESSION_TIMEOUT = 1200; // 20 minutes in seconds
const RENEW_BEFORE = 120; // Renew 2 minutes before expiry
const CHECK_INTERVAL = 1; // Check every 1 minute
const RETRY_DELAYS = [5, 15, 45]; // Exponential backoff in seconds

// Initialize
chrome.runtime.onInstalled.addListener(() => {
  setupAlarms();
  loadState();
});

chrome.runtime.onStartup.addListener(() => {
  setupAlarms();
  loadState();
});

// Setup periodic checks
function setupAlarms() {
  chrome.alarms.create('connectivity-check', { periodInMinutes: CHECK_INTERVAL });
  chrome.alarms.onAlarm.addListener(handleAlarm);
}

async function handleAlarm(alarm) {
  if (alarm.name === 'connectivity-check') {
    const { paused } = await chrome.storage.local.get('paused');
    if (!paused) {
      await checkAndLogin();
    }
  }
}

// Load persisted state
async function loadState() {
  const data = await chrome.storage.local.get(['lastLoginAt', 'nextRenewAt', 'paused']);
  if (data.lastLoginAt) state.lastLoginAt = data.lastLoginAt;
  if (data.nextRenewAt) state.nextRenewAt = data.nextRenewAt;
  
  // Initial check
  if (!data.paused) {
    await checkAndLogin();
  }
}

// Update state and persist
function updateState(updates) {
  state = { ...state, ...updates };
  
  // Update icon based on status
  let iconPath = 'icons/icon-default-48.png';
  let badgeText = '';
  
  switch (state.status) {
    case 'connected':
      iconPath = 'icons/icon-green-48.png';
      badgeText = 'OK';
      break;
    case 'error':
    case 'network_down':
      iconPath = 'icons/icon-red-48.png';
      badgeText = 'ERR';
      break;
    default:
      badgeText = '—';
  }
  
  chrome.action.setIcon({ path: iconPath });
  chrome.action.setBadgeText({ text: badgeText });
  chrome.action.setBadgeBackgroundColor({ color: '#666666' });
  
  // Persist important state
  if (updates.lastLoginAt !== undefined || updates.nextRenewAt !== undefined) {
    chrome.storage.local.set({
      lastLoginAt: state.lastLoginAt,
      nextRenewAt: state.nextRenewAt
    });
  }
  
  // Broadcast state change
  chrome.runtime.sendMessage({ type: 'state-update', state }).catch(() => {});
}

// Check connectivity with better error handling
async function checkConnectivity() {
  try {
    // First try the Google connectivity check
    const response = await fetch('https://connectivitycheck.gstatic.com/generate_204', {
      method: 'GET',
      cache: 'no-cache',
      redirect: 'manual'
    });
    
    // If we get 204, we're connected
    if (response.status === 204) {
      return { connected: true };
    }
    
    // If we get redirected (status 0 in CORS) or 302, likely captive portal
    if (response.status === 0 || response.status === 302 || response.type === 'opaqueredirect') {
      return { connected: false, needsLogin: true };
    }
    
    // Try to fetch the portal page directly
    try {
      const portalResponse = await fetch(PORTAL_URL, {
        method: 'GET',
        credentials: 'include',
        redirect: 'manual'
      });
      
      if (portalResponse.ok) {
        const text = await portalResponse.text();
        if (text.includes('login-form') || text.includes('username')) {
          return { connected: false, needsLogin: true };
        }
      }
    } catch (e) {
      // Portal might be down but network is up
    }
    
    return { connected: false, needsLogin: true };
    
  } catch (error) {
    // Network is likely down
    return { connected: false, networkDown: true };
  }
}

// Main check and login flow
async function checkAndLogin(forceLogin = false) {
  updateState({ status: 'checking' });
  
  // Check if we need to renew
  const now = Date.now();
  const shouldRenew = state.nextRenewAt && now >= state.nextRenewAt;
  
  if (!forceLogin && !shouldRenew) {
    // Regular connectivity check
    const connectivity = await checkConnectivity();
    
    if (connectivity.connected) {
      updateState({ 
        status: 'connected',
        isConnected: true,
        lastError: null,
        retryCount: 0
      });
      return;
    } else if (connectivity.networkDown) {
      await handleNetworkDown();
      return;
    }
  }
  
  // Need to login
  await performLogin();
}

// Handle network down
async function handleNetworkDown() {
  if (state.retryCount < RETRY_DELAYS.length) {
    const delay = RETRY_DELAYS[state.retryCount];
    updateState({ 
      status: 'network_down',
      lastError: 'Network unreachable',
      retryCount: state.retryCount + 1
    });
    
    setTimeout(() => checkAndLogin(), delay * 1000);
  } else {
    updateState({ 
      status: 'network_down',
      lastError: 'Network unreachable - max retries exceeded'
    });
  }
}

// Perform login with better error handling
async function performLogin() {
  try {
    const { encryptedCreds } = await chrome.storage.local.get('encryptedCreds');
    
    if (!encryptedCreds) {
      updateState({ 
        status: 'error',
        lastError: 'Credentials not configured',
        isConnected: false
      });
      showCredentialsNotification();
      return;
    }
    
    const credentials = await credentialManager.decryptCredentials(encryptedCreds);
    
    if (!credentials || !credentials.username || !credentials.password) {
      updateState({ 
        status: 'error',
        lastError: 'Failed to decrypt credentials',
        isConnected: false
      });
      showCredentialsNotification();
      return;
    }
    
    const { username, password } = credentials;
    updateState({ status: 'checking' });
    //const { username, password } = await chrome.storage.local.get(['username', 'password']);
    
    //if (!username || !password) {
    //  updateState({ 
    //    status: 'error',
    //    lastError: 'Credentials not configured',
    //    isConnected: false
    //  });
    //  showCredentialsNotification();
    //  return;
    //}
    //
    //updateState({ status: 'checking' });
    
    // Step 1: Get login page to extract magic token
    const loginPageResponse = await fetch(PORTAL_URL, {
      method: 'GET',
      credentials: 'include',
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      }
    });
    
    if (!loginPageResponse.ok) {
      throw new Error(`Failed to fetch login page: ${loginPageResponse.status}`);
    }
    
    const loginPageHtml = await loginPageResponse.text();
    
    // Parse magic token and other fields using regex as backup
    let magic = '';
    let tredir = PORTAL_URL;
    
    // Try regex parsing first (more reliable than DOMParser in service worker)
    const magicMatch = loginPageHtml.match(/name="magic"\s+value="([^"]+)"/);
    const tredirMatch = loginPageHtml.match(/name="4Tredir"\s+value="([^"]+)"/);
    
    if (magicMatch) {
      magic = magicMatch[1];
    } else {
      throw new Error('Could not find magic token');
    }
    
    if (tredirMatch) {
      tredir = tredirMatch[1];
    }
    
    // Step 2: Submit login form
    const formData = new URLSearchParams();
    formData.append('username', username);
    formData.append('password', password);
    formData.append('magic', magic);
    formData.append('4Tredir', tredir);
    
    const loginResponse = await fetch(`${PORTAL_BASE}/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Origin': PORTAL_BASE,
        'Referer': PORTAL_URL
      },
      body: formData.toString(),
      credentials: 'include',
      redirect: 'manual'
    });
    
    // Check if login was successful
    let isSuccess = false;
    
    // Check for redirect (successful login usually redirects)
    if (loginResponse.status === 302 || loginResponse.status === 303) {
      isSuccess = true;
    } else if (loginResponse.ok) {
      const responseText = await loginResponse.text();
      // Look for success indicators
      if (responseText.includes('keepalive') || 
          responseText.includes('Logout') ||
          responseText.includes('success') ||
          !responseText.includes('login-form')) {
        isSuccess = true;
      } else if (responseText.includes('Invalid') || 
                 responseText.includes('failed') ||
                 responseText.includes('incorrect')) {
        updateState({
          status: 'error',
          lastError: 'Invalid credentials',
          isConnected: false
        });
        showCredentialsNotification();
        return;
      }
    }
    
    if (isSuccess) {
      const now = Date.now();
      const nextRenew = now + ((SESSION_TIMEOUT - RENEW_BEFORE) * 1000);
      
      updateState({
        status: 'connected',
        isConnected: true,
        lastError: null,
        lastLoginAt: now,
        nextRenewAt: nextRenew,
        retryCount: 0
      });
    } else {
      throw new Error('Login failed - unknown response');
    }
    
  } catch (error) {
    console.error('Login error:', error);
    
    if (state.retryCount < RETRY_DELAYS.length) {
      const delay = RETRY_DELAYS[state.retryCount];
      updateState({
        status: 'error',
        lastError: error.message,
        retryCount: state.retryCount + 1
      });
      
      setTimeout(() => performLogin(), delay * 1000);
    } else {
      updateState({
        status: 'error',
        lastError: 'Portal unreachable - ' + error.message,
        isConnected: false
      });
    }
  }
}

// Show notification for invalid credentials
function showCredentialsNotification() {
  chrome.notifications.create('credentials-needed', {
    type: 'basic',
    iconUrl: 'icons/icon-red-48.png',
    title: 'IITG Wi-Fi Auto Login',
    message: 'Invalid credentials. Please update your username and password in the extension options.',
    buttons: [{ title: 'Open Options' }],
    requireInteraction: true
  });
}

// Handle notification clicks
chrome.notifications.onButtonClicked.addListener((notificationId, buttonIndex) => {
  if (notificationId === 'credentials-needed' && buttonIndex === 0) {
    chrome.runtime.openOptionsPage();
  }
  chrome.notifications.clear(notificationId);
});

// Message handling
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.type) {
    case 'get-state':
      sendResponse(state);
      break;
      
    case 'force-login':
      if (0) {
        sendResponse({ success: false, message: 'Already connected' });
      } else {
        checkAndLogin(true).then(() => {
          sendResponse({ success: true });
        });
      }
      return true; // Will respond asynchronously
      
    case 'toggle-pause':
      chrome.storage.local.set({ paused: request.paused }).then(() => {
        if (!request.paused) {
          checkAndLogin();
        }
        sendResponse({ success: true });
      });
      return true; // Will respond asynchronously
      
    default:
      sendResponse({ error: 'Unknown message type' });
  }
});

// Listen for storage changes from options page
chrome.storage.onChanged.addListener((changes, namespace) => {
  if (namespace === 'local') {
    if (changes.username || changes.password) {
      // Credentials updated, clear error state if any
      if (state.lastError === 'Credentials not configured' || 
          state.lastError === 'Invalid credentials') {
        updateState({ lastError: null, status: 'idle' });
        checkAndLogin();
      }
    }
  }
});

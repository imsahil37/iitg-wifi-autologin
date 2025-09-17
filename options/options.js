import { credentialManager } from '../utils/crypto-utils.js';
// crypto--encryption
//const credManager = new credentialManager();
//credManager.initialize();

// Get elements
const credentialsForm = document.getElementById('credentials-form');
const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const saveMessage = document.getElementById('save-message');
const pauseToggle = document.getElementById('pause-toggle');
const currentStatusEl = document.getElementById('current-status');
const lastLoginEl = document.getElementById('last-login');
const nextRenewalEl = document.getElementById('next-renewal');

// Status mapping
const statusText = {
  idle: 'Idle',
  checking: 'Checking...',
  connected: 'Connected',
  needs_login: 'Needs login',
  error: 'Error',
  network_down: 'Network down'
};

// Format timestamp
function formatTimestamp(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  return date.toLocaleString();
}

// Format future time
function formatFutureTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  
  if (date < now) return 'Expired';
  
  const diff = date - now;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  
  if (hours > 0) {
    return `${date.toLocaleString()} (in ${hours}h ${mins}m)`;
  } else {
    return `${date.toLocaleString()} (in ${mins}m)`;
  }
}

// Show message
function showMessage(text, type) {
  saveMessage.textContent = text;
  saveMessage.className = `message ${type}`;
  saveMessage.style.display = 'block';
  
  setTimeout(() => {
    saveMessage.style.display = 'none';
  }, 3000);
}

// Load saved settings
async function loadSettings() {
  try {
    const data = await chrome.storage.local.get(['encryptedCreds', 'paused']);

    if (data.encryptedCreds) {
      usernameInput.placeholder = "Username saved (encrypted)";
      passwordInput.placeholder = "Password saved (encrypted)";
    }
    
    pauseToggle.checked = data.paused || false;

 //   
 //   if (data.username) {
 //     usernameInput.value = data.username;
 //   }
 //   if (data.password) {
 //     passwordInput.value = data.password;
 //   }
 //   
 //   pauseToggle.checked = data.paused || false;
    
  } catch (error) {
    console.error('Error loading settings:', error);
  }
}

// Load status
async function loadStatus() {
  try {
    const response = await chrome.runtime.sendMessage({ type: 'get-state' });
    
    currentStatusEl.textContent = statusText[response.status] || 'Unknown';
    lastLoginEl.textContent = formatTimestamp(response.lastLoginAt);
    nextRenewalEl.textContent = formatFutureTime(response.nextRenewAt);
    
    // Update status color
    if (response.status === 'connected') {
      currentStatusEl.style.color = 'var(--md-sys-color-success)';
    } else if (response.status === 'error' || response.status === 'network_down') {
      currentStatusEl.style.color = 'var(--md-sys-color-error)';
    } else {
      currentStatusEl.style.color = '';
    }
    
  } catch (error) {
    console.error('Error loading status:', error);
  }
}

// Save credentials
credentialsForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  
  if (!username || !password) {
    showMessage('Please enter both username and password', 'error');
    return;
  }
  
  try {
    const encrypted = await credentialManager.encryptCredentials(username, password);
    await chrome.storage.local.set({ encryptedCreds: encrypted });
    
    // Clear form for security
    usernameInput.value = '';
    passwordInput.value = '';
    
    showMessage('Credentials encrypted and saved successfully!', 'success');
    chrome.runtime.sendMessage({ type: 'force-login' });
//    await chrome.storage.local.set({ username, password });
//    showMessage('Credentials saved successfully!', 'success');
    
//    // Trigger a check if credentials were previously missing
//    chrome.runtime.sendMessage({ type: 'force-login' });
    
  } catch (error) {
    console.error('Error saving credentials:', error);
    showMessage('Error saving credentials', 'error');
  }
});

// Pause toggle
pauseToggle.addEventListener('change', async () => {
  try {
    await chrome.runtime.sendMessage({ 
      type: 'toggle-pause', 
      paused: pauseToggle.checked 
    });
  } catch (error) {
    console.error('Toggle pause error:', error);
  }
});

// Listen for state updates
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'state-update') {
    loadStatus();
  }
});

// Initial load
loadSettings();
loadStatus();

// Refresh status periodically
const refreshInterval = setInterval(loadStatus, 5000);

// Clean up on unload
window.addEventListener('unload', () => {
  clearInterval(refreshInterval);
});

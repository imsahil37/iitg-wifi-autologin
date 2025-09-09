// Get elements
const statusChip = document.getElementById('status-chip');
const statusText = statusChip.querySelector('.status-text');
const forceLoginBtn = document.getElementById('force-login');
const pauseToggle = document.getElementById('pause-toggle');
const lastLoginEl = document.getElementById('last-login');
const nextRenewalEl = document.getElementById('next-renewal');
const lastErrorEl = document.getElementById('last-error');
const optionsLink = document.getElementById('options-link');

// Status to UI mapping
const statusConfig = {
  idle: { text: 'Idle', className: '' },
  checking: { text: 'Checking...', className: '' },
  connected: { text: 'Connected', className: 'connected' },
  needs_login: { text: 'Needs login', className: '' },
  error: { text: 'Error', className: 'error' },
  network_down: { text: 'Network down', className: 'error' }
};

// Format timestamp
function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) {
    return 'Just now';
  } else if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes}m ago`;
  } else if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } else {
    return date.toLocaleDateString();
  }
}

// Format future time
function formatFutureTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = date - now;
  
  if (diff < 0) return 'Now';
  if (diff < 60000) return 'Less than 1m';
  
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `In ${minutes}m`;
  
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `In ${hours}h ${mins}m`;
}

// Update UI based on state
function updateUI(state) {
  // Update status chip
  const config = statusConfig[state.status] || statusConfig.idle;
  statusText.textContent = config.text;
  statusChip.className = 'status-chip' + (config.className ? ' ' + config.className : '');
  
  // Update diagnostics
  lastLoginEl.textContent = formatTime(state.lastLoginAt);
  nextRenewalEl.textContent = formatFutureTime(state.nextRenewAt);
  lastErrorEl.textContent = state.lastError || '-';
  
  // Update force login button
  forceLoginBtn.disabled = state.status === 'checking';
  
  // Update button text based on state
  if (state.status === 'connected') {
    forceLoginBtn.textContent = 'Force Login';
  } else {
    forceLoginBtn.textContent = 'Login Now';
  }
}

// Load initial state
async function loadState() {
  try {
    // Get pause state
    const { paused } = await chrome.storage.local.get('paused');
    pauseToggle.checked = paused || false;
    
    // Get current state from background
    const response = await chrome.runtime.sendMessage({ type: 'get-state' });
    updateUI(response);
  } catch (error) {
    console.error('Error loading state:', error);
  }
}

// Force login
forceLoginBtn.addEventListener('click', async () => {
  forceLoginBtn.disabled = true;
  try {
    const response = await chrome.runtime.sendMessage({ type: 'force-login' });
    if (!response.success && response.message) {
      // Show temporary message
      const originalText = forceLoginBtn.textContent;
      forceLoginBtn.textContent = response.message;
      setTimeout(() => {
        forceLoginBtn.textContent = originalText;
      }, 2000);
    }
  } catch (error) {
    console.error('Force login error:', error);
  }
  forceLoginBtn.disabled = false;
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

// Options link
optionsLink.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
});

// Listen for state updates from background
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'state-update') {
    updateUI(message.state);
  }
});

// Initial load
loadState();

// Refresh state periodically while popup is open
const refreshInterval = setInterval(loadState, 5000);

// Clean up on unload
window.addEventListener('unload', () => {
  clearInterval(refreshInterval);
});

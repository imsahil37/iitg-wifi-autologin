// crypto-utils.js - Encryption utilities for SSO credentials

const CRYPTO_CONFIG = {
  name: 'AES-GCM',
  length: 256,
  ivLength: 12,
  saltLength: 16,
  iterations: 100000
};

export class CredentialManager {
  constructor() {
    this.initialized = false;
    this.keyMaterial = null;
  }

  async initialize() {
    if (this.initialized) return;
    
    const extensionId = chrome.runtime.id;
    const encoder = new TextEncoder();
    
    // Create a unique key for this installation
    const baseKey = await crypto.subtle.digest(
      'SHA-256',
      encoder.encode(extensionId + navigator.userAgent)
    );
    
    this.keyMaterial = await crypto.subtle.importKey(
      'raw',
      baseKey,
      { name: 'PBKDF2' },
      false,
      ['deriveKey']
    );
    
    this.initialized = true;
  }

  async getEncryptionKey() {
    const salt = await this.getOrCreateSalt();
    
    return crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: salt,
        iterations: CRYPTO_CONFIG.iterations,
        hash: 'SHA-256'
      },
      this.keyMaterial,
      { name: CRYPTO_CONFIG.name, length: CRYPTO_CONFIG.length },
      false,
      ['encrypt', 'decrypt']
    );
  }

  async getOrCreateSalt() {
    const { salt } = await chrome.storage.local.get('salt');
    
    if (salt) {
      return new Uint8Array(salt);
    }
    
    const newSalt = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.saltLength));
    await chrome.storage.local.set({ salt: Array.from(newSalt) });
    return newSalt;
  }

  async encryptCredentials(username, password) {
    await this.initialize();
    const key = await this.getEncryptionKey();
    const encoder = new TextEncoder();
    
    const credentials = JSON.stringify({ username, password });
    const iv = crypto.getRandomValues(new Uint8Array(CRYPTO_CONFIG.ivLength));
    
    const encrypted = await crypto.subtle.encrypt(
      { name: CRYPTO_CONFIG.name, iv },
      key,
      encoder.encode(credentials)
    );
    
    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(encrypted), iv.length);
    
    return {
      data: btoa(String.fromCharCode(...combined)),
      timestamp: Date.now()
    };
  }

  async decryptCredentials(encryptedData) {
    try {
      if (!encryptedData || !encryptedData.data) {
        return null;
      }
      
      await this.initialize();
      const key = await this.getEncryptionKey();
      const combined = Uint8Array.from(atob(encryptedData.data), c => c.charCodeAt(0));
      
      const iv = combined.slice(0, CRYPTO_CONFIG.ivLength);
      const encrypted = combined.slice(CRYPTO_CONFIG.ivLength);
      
      const decrypted = await crypto.subtle.decrypt(
        { name: CRYPTO_CONFIG.name, iv },
        key,
        encrypted
      );
      
      const credentials = JSON.parse(new TextDecoder().decode(decrypted));
      return credentials;
      
    } catch (error) {
      console.error('Decryption failed:', error);
      return null;
    }
  }
}

// Export singleton instance
export const credentialManager = new CredentialManager();

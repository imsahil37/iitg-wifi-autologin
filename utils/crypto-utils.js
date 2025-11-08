// crypto-utils.js - Encryption utilities for SSO credentials

const CRYPTO_CONFIG = {
  name: 'AES-GCM',
  length: 256,
  ivLength: 12
};

export class CredentialManager {
  constructor() {
    this.initialized = false;
    this.key = null;
  }

  async initialize() {
    if (this.initialized) return;

    const { encryptionKey } = await chrome.storage.local.get('encryptionKey');

    if (encryptionKey && Array.isArray(encryptionKey)) {
      const keyBytes = new Uint8Array(encryptionKey);
      this.key = await crypto.subtle.importKey(
        'raw',
        keyBytes,
        { name: CRYPTO_CONFIG.name },
        false,
        ['encrypt', 'decrypt']
      );
    } else {
      const generatedKey = await crypto.subtle.generateKey(
        { name: CRYPTO_CONFIG.name, length: CRYPTO_CONFIG.length },
        true,
        ['encrypt', 'decrypt']
      );

      const exported = new Uint8Array(await crypto.subtle.exportKey('raw', generatedKey));
      await chrome.storage.local.set({ encryptionKey: Array.from(exported) });
      this.key = generatedKey;
    }

    this.initialized = true;
  }

  async getEncryptionKey() {
    return this.key;
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

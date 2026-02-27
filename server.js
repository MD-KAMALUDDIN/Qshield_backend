const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' })); // Increase limit for encrypted files

// 🔐 Pinata API credentials (server-side only)
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET = process.env.PINATA_SECRET;

// In-memory storage structure:
// keyStorage[documentHash][walletAddress] = { encryptedSessionKey, mimeType, fileName }
const keyStorage = {};

// 🔐 Pinata upload proxy (keeps API keys server-side)
app.post('/upload-to-ipfs', async (req, res) => {
  try {
    const { encryptedData, fileName } = req.body;
    
    if (!encryptedData || !fileName) {
      return res.status(400).json({ error: 'Missing encrypted data or filename' });
    }
    
    // Create form data
    const formData = new FormData();
    const buffer = Buffer.from(encryptedData, 'utf-8');
    formData.append('file', buffer, fileName);
    
    // Upload to Pinata
    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'pinata_api_key': PINATA_API_KEY,
          'pinata_secret_api_key': PINATA_SECRET
        }
      }
    );
    
    console.log(`📤 Uploaded to IPFS: ${response.data.IpfsHash}`);
    res.json({ IpfsHash: response.data.IpfsHash });
    
  } catch (error) {
    console.error('IPFS upload error:', error.message);
    res.status(500).json({ error: 'Failed to upload to IPFS' });
  }
});

// Store encrypted key for a specific user (owner or verifier)
app.post('/keys', (req, res) => {
  const { user, documentHash, encryptedSessionKey, mimeType, fileName } = req.body;
  
  if (!user || !documentHash || !encryptedSessionKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  // Initialize document storage if not exists
  if (!keyStorage[documentHash]) {
    keyStorage[documentHash] = {};
  }
  
  // Store encrypted key + metadata for this user (never decrypt)
  keyStorage[documentHash][user] = {
    encryptedSessionKey,
    mimeType: mimeType || 'application/octet-stream',
    fileName: fileName || 'document'
  };
  
  console.log(`✅ Stored key for ${user.substring(0, 10)}... | Doc: ${documentHash.substring(0, 10)}...`);
  console.log(`   Total docs in storage: ${Object.keys(keyStorage).length}`);
  
  res.json({ success: true });
});

// Fetch encrypted keys for a specific user
app.get('/keys', (req, res) => {
  const { user } = req.query;
  
  if (!user) {
    return res.status(400).json({ error: 'User address required' });
  }
  
  const userKeys = {};
  
  for (const docHash in keyStorage) {
    if (keyStorage[docHash][user]) {
      userKeys[docHash] = keyStorage[docHash][user];
    }
  }
  
  console.log(`📥 Fetched ${Object.keys(userKeys).length} key(s) for ${user.substring(0, 10)}...`);
  console.log(`   Storage:`, JSON.stringify(keyStorage, null, 2));
  
  res.json(userKeys);
});

// Revoke access (delete encrypted key for verifier)
app.delete('/keys', (req, res) => {
  const { user, documentHash } = req.body;
  
  if (!user || !documentHash) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (keyStorage[documentHash] && keyStorage[documentHash][user]) {
    delete keyStorage[documentHash][user];
    console.log(`🚫 Revoked key for ${user.substring(0, 10)}... | Doc: ${documentHash.substring(0, 10)}...`);
    res.json({ success: true });
  } else {
    res.status(404).json({ error: 'Key not found' });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔐 Key storage backend running on port ${PORT}`);
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    totalDocuments: Object.keys(keyStorage).length,
    storage: keyStorage 
  });
});

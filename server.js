const express = require('express');
const cors = require('cors');
const axios = require('axios');
const FormData = require('form-data');
const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));

// 🔐 Pinata API credentials (server-side only)
const PINATA_API_KEY = process.env.PINATA_API_KEY;
const PINATA_SECRET = process.env.PINATA_SECRET;

// Fail fast if Render env vars are missing
if (!PINATA_API_KEY || !PINATA_SECRET) {
  throw new Error('Missing PINATA_API_KEY or PINATA_SECRET in environment variables');
}

// In-memory storage structure
// keyStorage[documentHash][walletAddress] = { encryptedSessionKey, mimeType, fileName }
const keyStorage = {};

// Root route so Render URL responds
app.get('/', (req, res) => {
  res.status(200).send('QShield backend is running');
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    totalDocuments: Object.keys(keyStorage).length
  });
});

// 🔐 Pinata upload proxy
app.post('/upload-to-ipfs', async (req, res) => {
  try {
    const { encryptedData, fileName } = req.body;

    if (!encryptedData || !fileName) {
      return res.status(400).json({ error: 'Missing encrypted data or filename' });
    }

    const formData = new FormData();
    const buffer = Buffer.from(encryptedData, 'utf-8');
    formData.append('file', buffer, fileName);

    const response = await axios.post(
      'https://api.pinata.cloud/pinning/pinFileToIPFS',
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          pinata_api_key: PINATA_API_KEY,
          pinata_secret_api_key: PINATA_SECRET
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

// Store encrypted key
app.post('/keys', (req, res) => {
  const { user, documentHash, encryptedSessionKey, mimeType, fileName } = req.body;

  if (!user || !documentHash || !encryptedSessionKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  if (!keyStorage[documentHash]) {
    keyStorage[documentHash] = {};
  }

  keyStorage[documentHash][user] = {
    encryptedSessionKey,
    mimeType: mimeType || 'application/octet-stream',
    fileName: fileName || 'document'
  };

  console.log(`✅ Stored key for ${user.substring(0, 10)}... | Doc: ${documentHash.substring(0, 10)}...`);
  res.json({ success: true });
});

// Fetch encrypted keys
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
  res.json(userKeys);
});

// Revoke access
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

// Render-compatible port binding
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🔐 Key storage backend running on port ${PORT}`);
});

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command
} = require('@aws-sdk/client-s3');

const BACKEND_ROOT = path.join(__dirname, '..');
const STORAGE_DRIVER = String(process.env.FILE_STORAGE_DRIVER || 'local').toLowerCase();
const IS_S3 = STORAGE_DRIVER === 's3';

let s3Client;

function normalizeKey(key) {
  return String(key || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function getLocalPath(key) {
  return path.join(BACKEND_ROOT, normalizeKey(key));
}

function ensureLocalDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function getS3Config() {
  const bucket = process.env.S3_BUCKET;
  if (!bucket) {
    throw new Error('S3_BUCKET is required when FILE_STORAGE_DRIVER=s3');
  }

  return {
    bucket,
    region: process.env.S3_REGION || 'auto',
    endpoint: process.env.S3_ENDPOINT || undefined,
    accessKeyId: process.env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || undefined,
    forcePathStyle: String(process.env.S3_FORCE_PATH_STYLE || '').toLowerCase() === 'true'
  };
}

function getS3Client() {
  if (!IS_S3) return null;
  if (s3Client) return s3Client;

  const cfg = getS3Config();
  s3Client = new S3Client({
    region: cfg.region,
    endpoint: cfg.endpoint,
    forcePathStyle: cfg.forcePathStyle,
    credentials: cfg.accessKeyId && cfg.secretAccessKey
      ? {
          accessKeyId: cfg.accessKeyId,
          secretAccessKey: cfg.secretAccessKey
        }
      : undefined
  });
  return s3Client;
}

async function saveBuffer(key, body, contentType = 'application/octet-stream') {
  const normalizedKey = normalizeKey(key);

  if (!IS_S3) {
    const fullPath = getLocalPath(normalizedKey);
    await fsp.mkdir(path.dirname(fullPath), { recursive: true });
    await fsp.writeFile(fullPath, body);
    return { key: normalizedKey };
  }

  const client = getS3Client();
  const cfg = getS3Config();
  await client.send(new PutObjectCommand({
    Bucket: cfg.bucket,
    Key: normalizedKey,
    Body: body,
    ContentType: contentType
  }));
  return { key: normalizedKey };
}

async function listFiles(prefix) {
  const normalizedPrefix = normalizeKey(prefix).replace(/\/?$/, '/');

  if (!IS_S3) {
    const dirPath = getLocalPath(normalizedPrefix);
    await fsp.mkdir(dirPath, { recursive: true });
    const entries = await fsp.readdir(dirPath, { withFileTypes: true });
    const files = await Promise.all(entries
      .filter(entry => entry.isFile())
      .map(async entry => {
        const fullPath = path.join(dirPath, entry.name);
        const stats = await fsp.stat(fullPath);
        return {
          key: normalizedPrefix + entry.name,
          size: stats.size,
          lastModified: stats.mtime,
          contentType: undefined
        };
      }));

    return files.sort((left, right) => new Date(right.lastModified) - new Date(left.lastModified));
  }

  const client = getS3Client();
  const cfg = getS3Config();
  const result = await client.send(new ListObjectsV2Command({
    Bucket: cfg.bucket,
    Prefix: normalizedPrefix
  }));

  return (result.Contents || [])
    .filter(item => item.Key && !item.Key.endsWith('/'))
    .map(item => ({
      key: item.Key,
      size: Number(item.Size || 0),
      lastModified: item.LastModified || new Date(),
      contentType: undefined
    }))
    .sort((left, right) => new Date(right.lastModified) - new Date(left.lastModified));
}

async function getFileStream(key) {
  const normalizedKey = normalizeKey(key);

  if (!IS_S3) {
    const fullPath = getLocalPath(normalizedKey);
    const stats = await fsp.stat(fullPath);
    return {
      stream: fs.createReadStream(fullPath),
      size: stats.size,
      lastModified: stats.mtime,
      contentType: undefined
    };
  }

  const client = getS3Client();
  const cfg = getS3Config();
  const result = await client.send(new GetObjectCommand({
    Bucket: cfg.bucket,
    Key: normalizedKey
  }));

  return {
    stream: result.Body,
    size: result.ContentLength,
    lastModified: result.LastModified,
    contentType: result.ContentType
  };
}

function initializeLocalStorage() {
  ensureLocalDir(getLocalPath('generated_pdfs'));
  ensureLocalDir(getLocalPath(path.join('uploads', 'attachments')));
}

initializeLocalStorage();

module.exports = {
  STORAGE_DRIVER,
  IS_S3,
  saveBuffer,
  listFiles,
  getFileStream,
  getLocalPath,
  normalizeKey
};

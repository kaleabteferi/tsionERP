const router = require('express').Router();
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { saveBuffer, listFiles, getFileStream } = require('../lib/fileStore');

const ATTACHMENT_PREFIX = 'uploads/attachments';

const allowedMimeTypes = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp'
]);
const allowedExtensions = new Set(['.pdf', '.jpg', '.jpeg', '.png', '.webp']);

function sanitizeBaseName(fileName) {
  const ext = path.extname(fileName);
  const baseName = path.basename(fileName, ext);
  const sanitized = baseName.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return sanitized || 'attachment';
}

function storageKey(fileName) {
  return `${ATTACHMENT_PREFIX}/${fileName}`;
}

function fileToResponse(fileName, fileMeta) {
  const displayName = fileName.includes('__')
    ? fileName.split('__').slice(2).join('__')
    : fileName.replace(/^[0-9]+-[0-9a-fA-F-]+-/, '');

  return {
    id: fileName,
    filename: fileName,
    originalName: displayName,
    size: Number(fileMeta.size || 0),
    uploadedAt: new Date(fileMeta.lastModified || Date.now()).toISOString(),
    url: `/api/uploads/attachments/${encodeURIComponent(fileName)}`
  };
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowedMimeTypes.has(file.mimetype) || !allowedExtensions.has(ext)) {
      return cb(new Error('Only PDF, JPG, PNG, and WEBP files are allowed'));
    }
    cb(null, true);
  }
});

router.get('/attachments', (req, res, next) => {
  (async () => {
    const files = await listFiles(ATTACHMENT_PREFIX);
    res.json(files.map(file => fileToResponse(path.posix.basename(file.key), file)));
  })().catch(next);
});

router.get('/attachments/:fileName', (req, res, next) => {
  (async () => {
    const fileName = path.posix.basename(req.params.fileName);
    const file = await getFileStream(storageKey(fileName));
    const ext = path.extname(fileName).toLowerCase();
    const fallbackType = ext === '.pdf'
      ? 'application/pdf'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : ext === '.png'
          ? 'image/png'
          : ext === '.webp'
            ? 'image/webp'
            : 'application/octet-stream';

    res.setHeader('Content-Type', file.contentType || fallbackType);
    res.setHeader('Content-Disposition', `inline; filename="${fileName.replace(/"/g, '')}"`);
    if (file.size) res.setHeader('Content-Length', String(file.size));
    file.stream.on('error', next);
    file.stream.pipe(res);
  })().catch(next);
});

router.post('/attachments', (req, res, next) => {
  upload.single('attachment')(req, res, async err => {
    if (err) {
      return res.status(400).json({ error: err.message || 'Attachment upload failed' });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'Attachment file is required' });
    }

    try {
      const ext = path.extname(req.file.originalname).toLowerCase();
      const fileName = `${Date.now()}__${uuidv4()}__${sanitizeBaseName(req.file.originalname)}${ext}`;
      await saveBuffer(storageKey(fileName), req.file.buffer, req.file.mimetype || 'application/octet-stream');
      res.status(201).json(fileToResponse(fileName, {
        size: req.file.size,
        lastModified: new Date()
      }));
    } catch (error) {
      next(error);
    }
  });
});

module.exports = router;
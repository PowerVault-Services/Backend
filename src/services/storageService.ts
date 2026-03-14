import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import http, { IncomingHttpHeaders, IncomingMessage, RequestOptions } from 'http';
import https from 'https';
import { Request, Response } from 'express';
import { projectRoot } from '../config/runtimePaths';

export type StoredFile = {
  fileUrl: string;
  objectKey: string;
  localPath: string;
  size: number;
  contentType: string;
  originalName?: string;
};

type StorageConfig = {
  driver: 'local' | 'minio';
  localRoot: string;
  publicBase: string;
  endpoint: URL | null;
  bucket: string;
  region: string;
  accessKey: string;
  secretKey: string;
  accessKeySource: string;
  secretKeySource: string;
  warnings: string[];
  readFromObjectStorage: boolean;
  writeToObjectStorage: boolean;
  fallbackToDisk: boolean;
  keepLocalCopy: boolean;
};

const MIME_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

class ObjectStorageError extends Error {
  statusCode?: number;
  constructor(message: string, statusCode?: number) {
    super(message);
    this.name = 'ObjectStorageError';
    this.statusCode = statusCode;
  }
}

class ObjectStorageNotFoundError extends ObjectStorageError {
  constructor(message = 'Object not found') {
    super(message, 404);
    this.name = 'ObjectStorageNotFoundError';
  }
}

function readBool(value: string | undefined, fallback: boolean) {
  if (value === undefined) return fallback;
  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function readTrimmedEnv(name: string) {
  const value = process.env[name];
  if (value === undefined) return '';
  return value.trim();
}

function pickEnv(names: string[]) {
  for (const name of names) {
    const value = readTrimmedEnv(name);
    if (value) return { value, source: name };
  }
  return { value: '', source: '' };
}

function maskValue(value: string, left = 3, right = 2) {
  if (!value) return '';
  if (value.length <= left + right) return `${value.slice(0, 1)}***`;
  return `${value.slice(0, left)}***${value.slice(-right)}`;
}

function isPlaceholderValue(value: string) {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return [
    'your-access-key',
    'your-secret-key',
    'change-me',
    'minioadmin',
    'password',
    'secret',
  ].includes(normalized);
}

function readConfig(): StorageConfig {
  const driver = readTrimmedEnv('STORAGE_DRIVER').toLowerCase() === 'minio' ? 'minio' : 'local';
  const localRoot = path.resolve(projectRoot, readTrimmedEnv('STORAGE_LOCAL_ROOT') || 'uploads');
  const publicBase = (readTrimmedEnv('STORAGE_PUBLIC_BASE') || '/uploads').replace(/\/$/, '');

  const endpointValue = pickEnv(['MINIO_ENDPOINT', 'S3_ENDPOINT']).value;
  const endpoint = endpointValue ? new URL(endpointValue) : null;
  if (endpoint && endpoint.port == '9001') {
    endpoint.port = '9000';
  }

  const bucket = pickEnv(['MINIO_BUCKET', 'BUCKET_NAME_PRIVATE', 'BUCKET_NAME_PUBLIC', 'BUCKET_NAME']).value;
  const region = pickEnv(['MINIO_REGION', 'S3_REGION', 'AWS_REGION']).value || 'us-east-1';
  const accessKeyPick = pickEnv(['MINIO_ACCESS_KEY', 'MINIO_ROOT_USER', 'MINIO_USER', 'S3_ACCESS_KEY', 'AWS_ACCESS_KEY_ID']);
  const secretKeyPick = pickEnv(['MINIO_SECRET_KEY', 'MINIO_ROOT_PASSWORD', 'MINIO_PASSWORD', 'S3_SECRET_KEY', 'AWS_SECRET_ACCESS_KEY']);
  const accessKey = accessKeyPick.value;
  const secretKey = secretKeyPick.value;

  const warnings: string[] = [];
  if (driver === 'minio') {
    if (!endpoint) warnings.push('MINIO endpoint is missing');
    if (!bucket) warnings.push('MINIO bucket is missing');
    if (!accessKey) warnings.push('MINIO access key is missing');
    if (!secretKey) warnings.push('MINIO secret key is missing');
    if (accessKey && isPlaceholderValue(accessKey)) warnings.push('MINIO access key still looks like a placeholder/default value');
    if (secretKey && isPlaceholderValue(secretKey)) warnings.push('MINIO secret key still looks like a placeholder/default value');
    if (accessKeyPick.source === 'AWS_ACCESS_KEY_ID' || secretKeyPick.source === 'AWS_SECRET_ACCESS_KEY') {
      warnings.push('Using generic AWS_* credentials while STORAGE_DRIVER=minio; verify these are the CE Cloud MinIO credentials you actually want');
    }
  }

  const objectReady = driver === 'minio' && !!endpoint && !!bucket && !!accessKey && !!secretKey;

  return {
    driver,
    localRoot,
    publicBase,
    endpoint,
    bucket,
    region,
    accessKey,
    secretKey,
    accessKeySource: accessKeyPick.source,
    secretKeySource: secretKeyPick.source,
    warnings,
    readFromObjectStorage: readBool(process.env.READ_FROM_OBJECT_STORAGE, objectReady),
    writeToObjectStorage: readBool(process.env.WRITE_TO_OBJECT_STORAGE, objectReady),
    fallbackToDisk: readBool(process.env.FALLBACK_TO_DISK, true),
    keepLocalCopy: readBool(process.env.MINIO_KEEP_LOCAL_COPY, true),
  };
}

const storageConfig = readConfig();

function objectStorageEnabled() {
  return !!(storageConfig.driver === 'minio' && storageConfig.endpoint && storageConfig.bucket && storageConfig.accessKey && storageConfig.secretKey);
}

function ensureParentDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function stripUploadsPrefix(value: string) {
  return value.replace(/^\/+/, '').replace(/^uploads\//, '');
}

export function normalizeFileUrl(fileUrl: string) {
  const clean = String(fileUrl ?? '').split('?')[0].split('#')[0].trim();
  if (!clean) return '';
  if (clean.startsWith('http://') || clean.startsWith('https://')) return clean;
  return clean.startsWith('/') ? clean : `/${clean.replace(/^\/+/, '')}`;
}

export function fileUrlToObjectKey(fileUrl: string) {
  const normalized = normalizeFileUrl(fileUrl);
  if (!normalized.startsWith('/')) return normalized;

  if (normalized.startsWith(`${storageConfig.publicBase}/v2/`)) {
    return normalized.replace(/^\//, '');
  }

  if (normalized.startsWith(`${storageConfig.publicBase}/legacy/`)) {
    return normalized.replace(/^\//, '');
  }

  if (normalized.startsWith(`${storageConfig.publicBase}/`)) {
    const legacyName = normalized.slice(`${storageConfig.publicBase}/`.length).replace(/^\/+/, '');
    return `uploads/legacy/${legacyName}`;
  }

  return normalized.replace(/^\//, '');
}

function buildObjectKeyReadCandidates(fileUrl: string) {
  const normalized = normalizeFileUrl(fileUrl);
  const candidates = new Set<string>();

  const primary = fileUrlToObjectKey(normalized);
  if (primary) candidates.add(primary);

  if (normalized.startsWith(`${storageConfig.publicBase}/`)) {
    const directKey = normalized.replace(/^\//, '');
    if (directKey) candidates.add(directKey);

    const tail = normalized.slice(`${storageConfig.publicBase}/`.length).replace(/^\/+/, '');
    if (tail && !normalized.startsWith(`${storageConfig.publicBase}/v2/`) && !normalized.startsWith(`${storageConfig.publicBase}/legacy/`)) {
      candidates.add(`uploads/legacy/${tail}`);
      candidates.add(`uploads/${tail}`);
    }

    if (normalized.startsWith(`${storageConfig.publicBase}/legacy/`)) {
      candidates.add(directKey.replace(/^uploads\/legacy\//, 'uploads/'));
    }
  }

  return Array.from(candidates).filter(Boolean);
}

export function objectKeyToFileUrl(objectKey: string) {
  const clean = objectKey.replace(/^\/+/, '');
  if (clean.startsWith('uploads/')) return `/${clean}`;
  return `${storageConfig.publicBase}/${clean}`.replace(/\/+/g, '/');
}

export function fileUrlToLocalPath(fileUrl: string) {
  const normalized = normalizeFileUrl(fileUrl);
  if (!normalized.startsWith('/')) return path.isAbsolute(normalized) ? normalized : path.join(storageConfig.localRoot, normalized);

  if (normalized.startsWith(`${storageConfig.publicBase}/v2/`)) {
    return path.join(storageConfig.localRoot, normalized.slice(`${storageConfig.publicBase}/`.length));
  }

  if (normalized.startsWith(`${storageConfig.publicBase}/legacy/`)) {
    return path.join(storageConfig.localRoot, normalized.slice(`${storageConfig.publicBase}/`.length));
  }

  if (normalized.startsWith(`${storageConfig.publicBase}/`)) {
    return path.join(storageConfig.localRoot, normalized.slice(`${storageConfig.publicBase}/`.length));
  }

  return path.join(storageConfig.localRoot, normalized.replace(/^\/+/, ''));
}


function buildLocalPathReadCandidates(fileUrl: string) {
  const normalized = normalizeFileUrl(fileUrl);
  const basename = path.basename(normalized);
  const candidates = new Set<string>();

  const primary = fileUrlToLocalPath(normalized);
  if (primary) candidates.add(primary);

  if (normalized.startsWith(`${storageConfig.publicBase}/`)) {
    const tail = normalized.slice(`${storageConfig.publicBase}/`.length).replace(/^\/+/, '');
    if (tail) {
      candidates.add(path.join(storageConfig.localRoot, tail));
      candidates.add(path.join(storageConfig.localRoot, 'legacy', tail.replace(/^legacy[\/]/, '')));
    }
  }

  if (basename) {
    candidates.add(path.join(storageConfig.localRoot, basename));
    candidates.add(path.join(storageConfig.localRoot, 'legacy', basename));
    candidates.add(path.join(projectRoot, 'uploads', basename));
    candidates.add(path.join(projectRoot, 'uploads', 'legacy', basename));
    candidates.add(path.join(projectRoot, 'public', 'uploads', basename));
    candidates.add(path.join(projectRoot, 'public', 'uploads', 'legacy', basename));
  }

  return Array.from(candidates).filter(Boolean);
}

function findExistingLocalPathFromCandidates(fileUrl: string) {
  for (const candidate of buildLocalPathReadCandidates(fileUrl)) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function findLocalFileByBasename(fileUrl: string) {
  const basename = path.basename(normalizeFileUrl(fileUrl));
  if (!basename) return null;

  const roots = [
    storageConfig.localRoot,
    path.join(projectRoot, 'uploads'),
    path.join(projectRoot, 'public', 'uploads'),
  ];

  const seen = new Set<string>();
  const skipNames = new Set(['node_modules', '.git', 'src', 'dist']);

  for (const root of roots) {
    if (!root || !fs.existsSync(root)) continue;
    const stack = [root];

    while (stack.length) {
      const dir = stack.pop()!;
      const resolved = path.resolve(dir);
      if (seen.has(resolved)) continue;
      seen.add(resolved);

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        continue;
      }

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isFile() && entry.name === basename) return fullPath;
        if (entry.isDirectory() && !skipNames.has(entry.name)) stack.push(fullPath);
      }
    }
  }

  return null;
}

async function copyToCanonicalLocalPath(sourcePath: string, canonicalPath: string) {
  if (path.resolve(sourcePath) === path.resolve(canonicalPath)) return canonicalPath;
  ensureParentDir(canonicalPath);
  await fsp.copyFile(sourcePath, canonicalPath);
  return canonicalPath;
}

async function backfillObjectStorageFromLocalPath(fileUrl: string, sourcePath: string) {
  if (!storageConfig.writeToObjectStorage || !objectStorageEnabled()) return;

  const primaryKey = fileUrlToObjectKey(fileUrl);
  if (!primaryKey) return;

  try {
    await headObject(primaryKey);
    return;
  } catch (error) {
    if (!(error instanceof ObjectStorageNotFoundError)) return;
  }

  try {
    const buffer = await fsp.readFile(sourcePath);
    await putObjectFromBuffer(primaryKey, buffer, extToMime(path.extname(sourcePath)), {
      recovered: 'true',
      source: 'disk-search',
    });
    console.log('♻️ Recovered local file back into object storage:', { fileUrl, objectKey: primaryKey, sourcePath });
  } catch (error) {
    console.warn('⚠️ Failed to backfill recovered local file into object storage:', {
      fileUrl,
      objectKey: primaryKey,
      sourcePath,
      error: (error as Error).message,
    });
  }
}

async function recoverLocalFilePath(fileUrl: string, canonicalPath: string) {
  const directHit = findExistingLocalPathFromCandidates(fileUrl);
  if (directHit) {
    const resolved = await copyToCanonicalLocalPath(directHit, canonicalPath);
    await backfillObjectStorageFromLocalPath(fileUrl, resolved);
    return resolved;
  }

  const recursiveHit = findLocalFileByBasename(fileUrl);
  if (recursiveHit) {
    const resolved = await copyToCanonicalLocalPath(recursiveHit, canonicalPath);
    await backfillObjectStorageFromLocalPath(fileUrl, resolved);
    console.log('🧭 Recovered file from local disk search:', { fileUrl, foundAt: recursiveHit, canonicalPath: resolved });
    return resolved;
  }

  return null;
}

function extToMime(ext: string) {
  return MIME_BY_EXT[ext.toLowerCase()] ?? 'application/octet-stream';
}

function sanitizePathPart(value: string) {
  return String(value ?? '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    || 'file';
}

function slugifyOriginalName(originalName: string) {
  const ext = path.extname(originalName);
  const base = path.basename(originalName, ext);
  const slug = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9ก-๙]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
  return slug || 'file';
}

function yyyyMm(date = new Date()) {
  return {
    yyyy: String(date.getFullYear()),
    mm: String(date.getMonth() + 1).padStart(2, '0'),
  };
}

function randomId() {
  return crypto.randomUUID();
}

function sha256Hex(input: Buffer | string) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function hmac(key: Buffer | string, data: string) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function encodeS3Path(value: string) {
  return value
    .split('/')
    .map((segment) => encodeURIComponent(segment).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`))
    .join('/');
}

function endpointHostHeader(endpoint: URL) {
  return endpoint.port ? `${endpoint.hostname}:${endpoint.port}` : endpoint.hostname;
}

function buildSignedBucketRequest(options: {
  method: string;
  query?: string;
  headers?: Record<string, string>;
  body?: Buffer;
}) {
  if (!storageConfig.endpoint) throw new Error('Object storage endpoint is not configured');

  const endpoint = storageConfig.endpoint;
  const method = options.method.toUpperCase();
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').replace(/Z$/, 'Z');
  const shortDate = amzDate.slice(0, 8);
  const canonicalUri = `/${storageConfig.bucket}`;
  const query = options.query ?? '';
  const payloadHash = sha256Hex(options.body ?? Buffer.alloc(0));

  const headers: Record<string, string> = {
    host: endpointHostHeader(endpoint),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(options.headers ?? {}),
  };

  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}\n`)
    .join('');

  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${shortDate}/${storageConfig.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${storageConfig.secretKey}`, shortDate);
  const kRegion = hmac(kDate, storageConfig.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${storageConfig.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers.Authorization = authorization;

  const requestPath = query ? `${canonicalUri}?${query}` : canonicalUri;
  const transport = endpoint.protocol === 'https:' ? https : http;

  const requestOptions: RequestOptions = {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port,
    method,
    path: requestPath,
    headers,
  };

  return { requestOptions, transport };
}

function buildSignedRequest(options: {
  method: string;
  objectKey: string;
  query?: string;
  headers?: Record<string, string>;
  body?: Buffer;
}) {
  if (!storageConfig.endpoint) throw new Error('Object storage endpoint is not configured');

  const endpoint = storageConfig.endpoint;
  const method = options.method.toUpperCase();
  const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '').replace(/Z$/, 'Z');
  const shortDate = amzDate.slice(0, 8);
  const canonicalUri = `/${storageConfig.bucket}/${encodeS3Path(options.objectKey)}`;
  const query = options.query ?? '';
  const payloadHash = sha256Hex(options.body ?? Buffer.alloc(0));

  const headers: Record<string, string> = {
    host: endpointHostHeader(endpoint),
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...(options.headers ?? {}),
  };

  const canonicalHeaders = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.trim()] as const)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}\n`)
    .join('');

  const signedHeaders = Object.keys(headers)
    .map((k) => k.toLowerCase())
    .sort()
    .join(';');

  const canonicalRequest = [
    method,
    canonicalUri,
    query,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const scope = `${shortDate}/${storageConfig.region}/s3/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = hmac(`AWS4${storageConfig.secretKey}`, shortDate);
  const kRegion = hmac(kDate, storageConfig.region);
  const kService = hmac(kRegion, 's3');
  const kSigning = hmac(kService, 'aws4_request');
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

  const authorization = `AWS4-HMAC-SHA256 Credential=${storageConfig.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers.Authorization = authorization;

  const requestPath = query ? `${canonicalUri}?${query}` : canonicalUri;
  const transport = endpoint.protocol === 'https:' ? https : http;

  const requestOptions: RequestOptions = {
    protocol: endpoint.protocol,
    hostname: endpoint.hostname,
    port: endpoint.port,
    method,
    path: requestPath,
    headers,
  };

  return { requestOptions, transport };
}

function requestObject(options: {
  method: string;
  objectKey: string;
  headers?: Record<string, string>;
  body?: Buffer;
}) {
  if (!objectStorageEnabled()) {
    throw new Error('Object storage is not configured');
  }

  const { requestOptions, transport } = buildSignedRequest(options);

  return new Promise<IncomingMessage>((resolve, reject) => {
    const req = transport.request(requestOptions, (res) => {
      const status = res.statusCode ?? 500;
      if (status >= 200 && status < 300) {
        return resolve(res);
      }

      if (status === 404) {
        res.resume();
        return reject(new ObjectStorageNotFoundError());
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8');
        reject(new ObjectStorageError(`Object storage request failed (${status}): ${bodyText || 'unknown error'}`, status));
      });
    });

    req.on('error', reject);
    if (options.body?.length) req.write(options.body);
    req.end();
  });
}

async function verifyUploadedObjectReadable(objectKey: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await headObject(objectKey);
      return;
    } catch (error) {
      lastError = error;
      if (!(error instanceof ObjectStorageNotFoundError) || attempt === 3) break;
      await new Promise((resolve) => setTimeout(resolve, attempt * 200));
    }
  }
  throw lastError;
}

export async function putObjectFromBuffer(objectKey: string, body: Buffer, contentType: string, metadata?: Record<string, string>) {
  const headers: Record<string, string> = {
    'content-type': contentType,
    'content-length': String(body.length),
  };

  for (const [key, value] of Object.entries(metadata ?? {})) {
    headers[`x-amz-meta-${key.toLowerCase()}`] = value;
  }

  const res = await requestObject({ method: 'PUT', objectKey, headers, body });
  res.resume();
  await verifyUploadedObjectReadable(objectKey);
}

export async function headObject(objectKey: string) {
  const res = await requestObject({ method: 'HEAD', objectKey });
  res.resume();
  return res.headers;
}

export async function deleteObject(objectKey: string) {
  try {
    const res = await requestObject({ method: 'DELETE', objectKey });
    res.resume();
  } catch (error) {
    if (error instanceof ObjectStorageNotFoundError) return;
    throw error;
  }
}

export async function streamObject(objectKey: string) {
  return requestObject({ method: 'GET', objectKey });
}

async function streamObjectFromFileUrl(fileUrl: string) {
  const candidates = buildObjectKeyReadCandidates(fileUrl);
  let lastError: unknown;

  for (const objectKey of candidates) {
    try {
      return await streamObject(objectKey);
    } catch (error) {
      lastError = error;
      if (!(error instanceof ObjectStorageNotFoundError)) throw error;
    }
  }

  throw lastError instanceof Error
    ? new ObjectStorageNotFoundError(`${lastError.message} | fileUrl=${normalizeFileUrl(fileUrl)} | tried=${candidates.join(', ')}`)
    : new ObjectStorageNotFoundError(`Object not found | fileUrl=${normalizeFileUrl(fileUrl)} | tried=${candidates.join(', ')}`);
}

export async function downloadObjectToLocalPath(objectKey: string, localPath: string) {
  const stream = await streamObject(objectKey);
  ensureParentDir(localPath);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(localPath);
    stream.pipe(out);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve());
  });
  return localPath;
}

async function downloadObjectToLocalPathFromFileUrl(fileUrl: string, localPath: string) {
  const stream = await streamObjectFromFileUrl(fileUrl);
  ensureParentDir(localPath);
  await new Promise<void>((resolve, reject) => {
    const out = fs.createWriteStream(localPath);
    stream.pipe(out);
    stream.on('error', reject);
    out.on('error', reject);
    out.on('finish', () => resolve());
  });
  return localPath;
}

async function persistBufferToDestinations(args: {
  buffer: Buffer;
  objectKey: string;
  localPath: string;
  contentType: string;
  metadata?: Record<string, string>;
}) {
  const { buffer, objectKey, localPath, contentType, metadata } = args;

  if (!storageConfig.writeToObjectStorage || !objectStorageEnabled()) {
    ensureParentDir(localPath);
    await fsp.writeFile(localPath, buffer);
    console.log('💾 Stored on disk only:', { localPath, bytes: buffer.length, contentType });
    return;
  }

  console.log('☁️ Uploading to object storage:', {
    endpoint: storageConfig.endpoint?.toString(),
    bucket: storageConfig.bucket,
    objectKey,
    bytes: buffer.length,
    contentType,
  });

  await putObjectFromBuffer(objectKey, buffer, contentType, metadata);
  console.log('☁️ Uploaded to object storage:', objectKey);

  if (storageConfig.keepLocalCopy || storageConfig.fallbackToDisk) {
    ensureParentDir(localPath);
    await fsp.writeFile(localPath, buffer);
    console.log('💾 Kept local copy:', localPath);
  }
}

async function finalizeTempFile(tempPath: string) {
  try {
    await fsp.unlink(tempPath);
  } catch {
    // noop
  }
}

function buildUserObjectKey(args: { scopeParts: string[]; originalName: string; bytes: number; hash12: string; now?: Date }) {
  const { yyyy, mm } = yyyyMm(args.now);
  const ext = path.extname(args.originalName).toLowerCase() || '';
  const slug = sanitizePathPart(slugifyOriginalName(args.originalName));
  return [
    'uploads',
    'v2',
    'user',
    ...args.scopeParts.map(sanitizePathPart),
    yyyy,
    mm,
    `${randomId()}__${args.hash12}__${args.bytes}__${slug}${ext}`,
  ].join('/');
}

function buildUploadedReportObjectKey(args: { jobType: string; jobNo: string; originalName: string; now?: Date }) {
  const { yyyy, mm } = yyyyMm(args.now);
  const ext = path.extname(args.originalName).toLowerCase() || '.pdf';
  return [
    'uploads',
    'v2',
    'reports',
    sanitizePathPart(args.jobType.toLowerCase()),
    yyyy,
    mm,
    sanitizePathPart(args.jobNo),
    `${randomId()}${ext}`,
  ].join('/');
}

function buildGeneratedReportObjectKey(args: { jobType: string; jobNo: string; ext?: string; now?: Date }) {
  const { yyyy, mm } = yyyyMm(args.now);
  return [
    'uploads',
    'v2',
    'generated',
    sanitizePathPart(args.jobType.toLowerCase()),
    yyyy,
    mm,
    sanitizePathPart(args.jobNo),
    `${randomId()}${(args.ext || '.pdf').toLowerCase()}`,
  ].join('/');
}

function buildExportObjectKey(args: { jobType: string; ext?: string; now?: Date }) {
  const { yyyy, mm } = yyyyMm(args.now);
  return [
    'uploads',
    'v2',
    'exports',
    sanitizePathPart(args.jobType.toLowerCase()),
    yyyy,
    mm,
    `${randomId()}${(args.ext || '.zip').toLowerCase()}`,
  ].join('/');
}

export function createTemporaryUploadDir() {
  const tmpDir = path.join(os.tmpdir(), 'solar-upload-staging');
  fs.mkdirSync(tmpDir, { recursive: true });
  return tmpDir;
}

export function createTemporaryArtifactPath(ext = '.tmp') {
  const dir = path.join(os.tmpdir(), 'solar-generated-artifacts');
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${randomId()}${ext.startsWith('.') ? ext : `.${ext}`}`);
}

export async function storeIncomingUserUpload(
  file: Express.Multer.File,
  options: { scopeParts: string[] },
): Promise<StoredFile> {
  const buffer = await fsp.readFile(file.path);
  const objectKey = buildUserObjectKey({
    scopeParts: options.scopeParts,
    originalName: file.originalname || path.basename(file.path),
    bytes: buffer.length,
    hash12: sha256Hex(buffer).slice(0, 12),
  });
  const fileUrl = objectKeyToFileUrl(objectKey);
  const localPath = fileUrlToLocalPath(fileUrl);
  const contentType = file.mimetype || extToMime(path.extname(file.originalname));

  await persistBufferToDestinations({
    buffer,
    objectKey,
    localPath,
    contentType,
    metadata: {
      originalname: file.originalname || path.basename(file.path),
      bytes: String(buffer.length),
    },
  });
  await finalizeTempFile(file.path);

  const result = { fileUrl, objectKey, localPath, size: buffer.length, contentType, originalName: file.originalname };
  console.log('🧭 storeIncomingUserUpload result:', result);
  return result;
}

export async function storeIncomingReportUpload(
  file: Express.Multer.File,
  options: { jobType: string; jobNo: string },
): Promise<StoredFile> {
  const buffer = await fsp.readFile(file.path);
  const objectKey = buildUploadedReportObjectKey({
    jobType: options.jobType,
    jobNo: options.jobNo,
    originalName: file.originalname || path.basename(file.path),
  });
  const fileUrl = objectKeyToFileUrl(objectKey);
  const localPath = fileUrlToLocalPath(fileUrl);
  const contentType = file.mimetype || extToMime(path.extname(file.originalname));

  await persistBufferToDestinations({
    buffer,
    objectKey,
    localPath,
    contentType,
    metadata: { originalname: file.originalname || path.basename(file.path) },
  });
  await finalizeTempFile(file.path);

  return { fileUrl, objectKey, localPath, size: buffer.length, contentType, originalName: file.originalname };
}

export async function storeGeneratedReportFromLocalFile(
  localSourcePath: string,
  options: { jobType: string; jobNo: string },
): Promise<StoredFile> {
  const buffer = await fsp.readFile(localSourcePath);
  const ext = path.extname(localSourcePath).toLowerCase() || '.pdf';
  const objectKey = buildGeneratedReportObjectKey({ jobType: options.jobType, jobNo: options.jobNo, ext });
  const fileUrl = objectKeyToFileUrl(objectKey);
  const localPath = fileUrlToLocalPath(fileUrl);
  const contentType = extToMime(ext);

  await persistBufferToDestinations({
    buffer,
    objectKey,
    localPath,
    contentType,
    metadata: { generated: 'true', jobtype: options.jobType.toLowerCase(), jobno: options.jobNo },
  });
  await finalizeTempFile(localSourcePath);

  return { fileUrl, objectKey, localPath, size: buffer.length, contentType };
}

export async function storeGeneratedExportFromLocalFile(
  localSourcePath: string,
  options: { jobType: string },
): Promise<StoredFile> {
  const buffer = await fsp.readFile(localSourcePath);
  const ext = path.extname(localSourcePath).toLowerCase() || '.zip';
  const objectKey = buildExportObjectKey({ jobType: options.jobType, ext });
  const fileUrl = objectKeyToFileUrl(objectKey);
  const localPath = fileUrlToLocalPath(fileUrl);
  const contentType = extToMime(ext);

  await persistBufferToDestinations({
    buffer,
    objectKey,
    localPath,
    contentType,
    metadata: { generated: 'true', export: 'true', jobtype: options.jobType.toLowerCase() },
  });

  return { fileUrl, objectKey, localPath, size: buffer.length, contentType };
}

export async function ensureLocalFilePath(fileUrl: string) {
  const localPath = fileUrlToLocalPath(fileUrl);
  if (fs.existsSync(localPath)) return localPath;

  const recoveredBeforeObjectRead = await recoverLocalFilePath(fileUrl, localPath);
  if (recoveredBeforeObjectRead) return recoveredBeforeObjectRead;

  let objectReadError: unknown = null;
  if (storageConfig.readFromObjectStorage && objectStorageEnabled()) {
    try {
      await downloadObjectToLocalPathFromFileUrl(fileUrl, localPath);
      return localPath;
    } catch (error) {
      objectReadError = error;
      if (!(error instanceof ObjectStorageNotFoundError)) throw error;
    }
  }

  const recoveredAfterObjectRead = await recoverLocalFilePath(fileUrl, localPath);
  if (recoveredAfterObjectRead) return recoveredAfterObjectRead;

  if (objectReadError) throw objectReadError;
  throw new ObjectStorageNotFoundError(`File not found on disk | fileUrl=${normalizeFileUrl(fileUrl)} | localPath=${localPath}`);
}

export async function tryEnsureLocalFilePath(fileUrl: string) {
  try {
    return await ensureLocalFilePath(fileUrl);
  } catch (error) {
    if (error instanceof ObjectStorageNotFoundError) return null;
    throw error;
  }
}

export async function deleteStoredFile(fileUrl: string) {
  const localPath = fileUrlToLocalPath(fileUrl);
  try {
    await fsp.unlink(localPath);
  } catch {
    // noop
  }

  if (storageConfig.writeToObjectStorage && objectStorageEnabled()) {
    const candidates = buildObjectKeyReadCandidates(fileUrl);
    for (const objectKey of candidates) {
      await deleteObject(objectKey);
    }
  }
}

export async function resolveEmailAttachment(fileUrl: string, preferredName?: string) {
  const localPath = await ensureLocalFilePath(fileUrl);
  return {
    filename: preferredName || path.basename(localPath),
    path: localPath,
  };
}

export async function tryResolveEmailAttachment(fileUrl: string, preferredName?: string) {
  const localPath = await tryEnsureLocalFilePath(fileUrl);
  if (!localPath) return null;
  return {
    filename: preferredName || path.basename(localPath),
    path: localPath,
  };
}

export async function serveFileUrlViaGateway(fileUrl: string, req: Request, res: Response) {
  const normalized = normalizeFileUrl(fileUrl);
  const method = req.method.toUpperCase();

  if (storageConfig.readFromObjectStorage && objectStorageEnabled()) {
    try {
      const upstream = await streamObjectFromFileUrl(normalized);
      const headers = upstream.headers;
      if (headers['content-type']) res.setHeader('Content-Type', headers['content-type']);
      if (headers['content-length']) res.setHeader('Content-Length', headers['content-length']);
      if (headers['etag']) res.setHeader('ETag', headers['etag']);
      if (headers['last-modified']) res.setHeader('Last-Modified', headers['last-modified']);
      if (method === 'HEAD') {
        upstream.resume();
        return res.status(200).end();
      }
      upstream.on('error', (error) => {
        if (!res.headersSent) res.status(502).json({ success: false, message: (error as Error).message });
      });
      upstream.pipe(res);
      return;
    } catch (error) {
      if (!(error instanceof ObjectStorageNotFoundError) && !storageConfig.fallbackToDisk) {
        return res.status(502).json({ success: false, message: (error as Error).message });
      }
      // else continue to disk fallback
    }
  }

  const recoveredLocalPath = await tryEnsureLocalFilePath(normalized);
  if (recoveredLocalPath && fs.existsSync(recoveredLocalPath)) {
    if (method === 'HEAD') return res.status(200).end();
    return res.sendFile(recoveredLocalPath);
  }

  return res.status(404).json({ success: false, message: 'File not found' });
}

export function getStorageConfigForDebug() {
  return {
    ...storageConfig,
    projectRoot,
    accessKey: maskValue(storageConfig.accessKey),
    secretKey: storageConfig.secretKey ? '***hidden***' : '',
  };
}

export async function migrateLegacyLocalFileToObjectStorage(fileUrl: string) {
  const localPath = fileUrlToLocalPath(fileUrl);
  if (!fs.existsSync(localPath)) return;
  if (!storageConfig.writeToObjectStorage || !objectStorageEnabled()) return;

  const objectKey = fileUrlToObjectKey(fileUrl);
  const buffer = await fsp.readFile(localPath);
  await putObjectFromBuffer(objectKey, buffer, extToMime(path.extname(localPath)), {
    migrated: 'true',
  });
}

export function guessMimeTypeFromPath(filePath: string) {
  return extToMime(path.extname(filePath));
}

export function storageFlagsSummary() {
  return {
    driver: storageConfig.driver,
    endpoint: storageConfig.endpoint?.toString() ?? '',
    bucket: storageConfig.bucket,
    readFromObjectStorage: storageConfig.readFromObjectStorage,
    writeToObjectStorage: storageConfig.writeToObjectStorage,
    fallbackToDisk: storageConfig.fallbackToDisk,
    keepLocalCopy: storageConfig.keepLocalCopy,
    objectStorageEnabled: objectStorageEnabled(),
    accessKeySource: storageConfig.accessKeySource || '',
    secretKeySource: storageConfig.secretKeySource || '',
    accessKeyPreview: maskValue(storageConfig.accessKey),
    hasSecretKey: !!storageConfig.secretKey,
    warnings: storageConfig.warnings,
  };
}

export async function verifyObjectStorageAccess() {
  if (!objectStorageEnabled() || !storageConfig.endpoint) {
    return { ok: false, skipped: true, message: 'Object storage is not fully configured' };
  }

  const { requestOptions, transport } = buildSignedBucketRequest({
    method: 'HEAD',
  });

  return new Promise<{ ok: boolean; statusCode?: number; message: string }>((resolve) => {
    const req = transport.request(requestOptions, (res) => {
      const status = res.statusCode ?? 500;
      if (status >= 200 && status < 300) {
        res.resume();
        return resolve({ ok: true, statusCode: status, message: `Bucket ${storageConfig.bucket} is reachable` });
      }

      const chunks: Buffer[] = [];
      res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
      res.on('end', () => {
        const bodyText = Buffer.concat(chunks).toString('utf8').trim();
        resolve({
          ok: false,
          statusCode: status,
          message: bodyText || `Bucket check failed with status ${status}`,
        });
      });
    });

    req.on('error', (error) => {
      resolve({ ok: false, message: (error as Error).message });
    });

    req.end();
  });
}

export type ObjectHeaders = IncomingHttpHeaders;

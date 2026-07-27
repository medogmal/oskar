import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

type StudyBucket = 'files' | 'reports';

const storageRoot = path.resolve(process.env.UPLOAD_ROOT ?? path.join(process.cwd(), 'uploads'));

const sanitizePathSegment = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80) || 'item';

const sanitizeFileName = (value: string) => {
  const extension = path.extname(value).replace(/[^a-zA-Z0-9.]/g, '').slice(0, 16);
  const baseName = sanitizePathSegment(path.basename(value, path.extname(value)));
  return `${baseName}-${randomUUID()}${extension}`;
};

const assertWithinStorageRoot = (absolutePath: string) => {
  const resolvedRoot = `${storageRoot}${path.sep}`;
  if (absolutePath !== storageRoot && !absolutePath.startsWith(resolvedRoot)) {
    throw new Error('Resolved storage path is outside the upload directory');
  }
};

export const resolveStoredPath = (relativePath: string) => {
  const normalizedRelativePath = relativePath.replace(/\\/g, '/');
  const absolutePath = path.resolve(storageRoot, normalizedRelativePath);
  assertWithinStorageRoot(absolutePath);
  return absolutePath;
};

export const saveBufferToStudyBucket = async (
  studyId: string,
  bucket: StudyBucket,
  originalName: string,
  buffer: Buffer | Uint8Array,
) => {
  const safeStudyId = sanitizePathSegment(studyId);
  const storedName = sanitizeFileName(originalName);
  const relativePath = path.posix.join('studies', safeStudyId, bucket, storedName);
  const absolutePath = resolveStoredPath(relativePath);

  await fs.mkdir(path.dirname(absolutePath), { recursive: true });
  await fs.writeFile(absolutePath, buffer);

  return {
    storedName,
    relativePath,
    absolutePath,
  };
};

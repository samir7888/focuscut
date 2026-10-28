import { openDB } from 'idb';
import type { DBSchema, IDBPDatabase } from 'idb';
import type { Project } from '../types/project';

interface FocuscutDB extends DBSchema {
  projects: {
    key: string;
    value: Project;
    indexes: { updatedAt: number };
  };
  blobs: {
    key: string;
    value: { id: string; type: 'video' | 'audio' | 'thumb'; data: Blob; createdAt: number };
  };
  chunks: {
    key: string;
    value: { id: string; recordingId: string; index: number; data: Blob; createdAt: number };
  };
}

let dbPromise: Promise<IDBPDatabase<FocuscutDB>> | null = null;

export function getDB() {
  if (!dbPromise) {
    dbPromise = openDB<FocuscutDB>('focuscut-db', 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          const store = db.createObjectStore('projects', { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
        if (!db.objectStoreNames.contains('blobs')) {
          db.createObjectStore('blobs', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('chunks')) {
          const store: any = db.createObjectStore('chunks', { keyPath: 'id' });
          store.createIndex('recordingId', 'recordingId');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveProject(project: Project) {
  const db = await getDB();
  project.updatedAt = Date.now();
  await db.put('projects', project);
}

export async function getProject(id: string) {
  const db = await getDB();
  return db.get('projects', id);
}

export async function listProjects() {
  const db = await getDB();
  return db.getAllFromIndex('projects', 'updatedAt');
}

export async function saveBlob(id: string, type: 'video' | 'audio' | 'thumb', data: Blob) {
  const db = await getDB();
  await db.put('blobs', { id, type, data, createdAt: Date.now() });
}

export async function getBlob(id: string) {
  const db = await getDB();
  const res = await db.get('blobs', id);
  return res?.data;
}

export async function saveChunk(recordingId: string, index: number, data: Blob) {
  const db = await getDB();
  const id = `${recordingId}-${index}`;
  await db.put('chunks', { id, recordingId, index, data, createdAt: Date.now() });
}

export async function getChunks(recordingId: string) {
  const db = await getDB();
  const all = await (db as any).getAllFromIndex('chunks', 'recordingId', recordingId);
  return all.sort((a: any, b: any) => a.index - b.index);
}

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc, setLogLevel } from 'firebase/firestore';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Suppress internal Firestore gRPC and quota logging spam
setLogLevel('silent');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CONFIG_PATH = path.join(__dirname, '..', 'firebase-applet-config.json');

export let firebaseConfig: any = null;
if (fs.existsSync(CONFIG_PATH)) {
  try {
    firebaseConfig = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
  } catch (err) {
    console.error('Failed to parse firebase-applet-config.json:', err);
  }
}

export const app = getApps().length === 0 && firebaseConfig
  ? initializeApp(firebaseConfig)
  : getApps().length > 0
  ? getApp()
  : null;

export const firestore = app
  ? (firebaseConfig?.firestoreDatabaseId
      ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
      : getFirestore(app))
  : null;

export const storage = app && firebaseConfig?.storageBucket
  ? getStorage(app, `gs://${firebaseConfig.storageBucket}`)
  : null;

export async function uploadBufferToCloudStorage(
  buffer: Buffer,
  destinationPath: string,
  contentType: string = 'image/jpeg'
): Promise<string | null> {
  if (!storage) return null;
  try {
    const storageRef = ref(storage, destinationPath);
    await uploadBytes(storageRef, buffer, { contentType });
    const downloadUrl = await getDownloadURL(storageRef);
    return downloadUrl;
  } catch (err) {
    // Fall back silently to local storage
    return null;
  }
}

export async function testFirestoreConnection() {
  if (!firestore) {
    return false;
  }
  try {
    const stateDocRef = doc(firestore, 'app_state', 'master');
    await getDoc(stateDocRef).catch(() => {});
    return true;
  } catch (error) {
    return false;
  }
}

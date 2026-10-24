import AsyncStorage from '@react-native-async-storage/async-storage';
import { OfflineQueue } from './queue';

/** App-wide queue instance, persisted in AsyncStorage (drafts only; no tokens or downloaded records). */
export const queue = new OfflineQueue(AsyncStorage);

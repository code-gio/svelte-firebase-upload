// Main exports for the Firebase Upload Manager library

// Core upload manager
export { default as FirebaseUploadManager } from './upload-manager.svelte.js';

// Drag and drop component
export { default as DragAndDrop } from './components/drag-and-drop.svelte';

// Types
export type {
	UploadManagerConfig,
	UploadItem,
	UploadTask,
	SpeedSample,
	UploadManagerOptions,
	FirebaseStorage,
	UploadStatus,
	ValidationRule,
	ValidationResult,
	ResumableUploadState,
	HealthStatus,
	HealthCheckResult,
	StorageQuota,
	PermissionStatus
} from './types.js';

// Utility managers
export { MemoryManager } from './utils/memory-manager.svelte.js';
export { NetworkManager } from './utils/network-manager.svelte.js';
export { BandwidthManager } from './utils/bandwidth-manager.svelte.js';
export { FileValidator } from './utils/file-validator.svelte.js';
export { UploadResumer } from './utils/upload-resumer.svelte.js';
export { PluginSystem } from './utils/plugin-system.svelte.js';

// Core upload manager
export { default as FirebaseUploadManager } from './upload-manager.svelte.js';

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
	PermissionStatus,
	UploadPlugin,
	PluginConfig,
	UploadManagerInterface,
	ChunkState,
	ResumeOptions
} from './types.js';

// Utility managers
export { MemoryManager } from './utils/memory-manager.svelte.js';
export { NetworkManager } from './utils/network-manager.svelte.js';
export { BandwidthManager } from './utils/bandwidth-manager.svelte.js';
export { FileValidator } from './utils/file-validator.svelte.js';
export { UploadResumer } from './utils/upload-resumer.svelte.js';
export { PluginSystem } from './utils/plugin-system.svelte.js';

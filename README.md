# Svelte Firebase Upload

A powerful, enterprise-grade file upload manager for Svelte applications with Firebase Storage integration. Features concurrent uploads, resumable transfers, smart queue management, comprehensive validation, health monitoring, and an extensible plugin system.

## ✨ Features

### Core Upload Features
- **🚀 Concurrent Uploads** - Upload multiple files simultaneously with configurable limits
- **📊 Real-time Progress** - Track upload progress, speed, and time estimates
- **🔄 Resumable Uploads** - Automatic retry and resumption for interrupted transfers
- **⚡ Smart Scheduling** - Prioritizes smaller files for quick user feedback
- **📦 Batch Processing** - Efficiently handles large file sets (1000+ files)

### Advanced Capabilities
- **🔍 File Validation** - Size, type, and custom validation rules with duplicate detection
- **🏥 Health Monitoring** - Periodic checks for network, storage, and permissions
- **🌐 Network Adaptation** - Bandwidth throttling and network quality detection
- **💾 Memory Management** - Virtual queuing for large file sets to prevent memory issues
- **🔌 Plugin System** - Extensible architecture with built-in plugins for logging, analytics, and processing

### Developer Experience
- **📝 TypeScript Support** - Full type definitions for better development experience
- **🎯 Svelte 5 Ready** - Built with Svelte 5's latest reactivity system
- **🛠️ Configuration Validation** - Runtime validation with helpful warnings
- **📈 Performance Metrics** - Built-in analytics and monitoring capabilities

## 📦 Installation

Install the package and its peer dependencies:

```bash
npm install svelte-firebase-upload firebase
```

### Peer Dependencies
- `firebase` ^11.10.0
- `svelte` ^5.0.0

## 🚀 Quick Start

### 1. Initialize Firebase

```typescript
import { initializeApp } from 'firebase/app';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  // Your Firebase configuration
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "your-sender-id",
  appId: "your-app-id"
};

const app = initializeApp(firebaseConfig);
const storage = getStorage(app);
```

### 2. Basic Usage

```svelte
<script lang="ts">
  import { FirebaseUploadManager } from 'svelte-firebase-upload';
  import { getStorage } from 'firebase/storage';

  let fileInput: HTMLInputElement;
  let manager: FirebaseUploadManager;

  $effect(() => {
    // Initialize the upload manager
    manager = new FirebaseUploadManager({
      maxConcurrentUploads: 3,
      chunkSize: 2 * 1024 * 1024, // 2MB chunks
      autoStart: true,
      enableSmartScheduling: true,
      enableHealthChecks: true
    });

    // Set your Firebase Storage instance
    manager.setStorage(getStorage());
  });

  async function handleFileSelect(event: Event) {
    const files = (event.target as HTMLInputElement).files;
    if (files) {
      await manager.addFiles(files, {
        path: 'user-uploads/',
        metadata: { uploadedBy: 'user123' }
      });
    }
  }
</script>

<input bind:this={fileInput} type="file" multiple on:change={handleFileSelect} />

{#if manager}
  <div class="upload-stats">
    <div>Progress: {manager.totalProgress.toFixed(1)}%</div>
    <div>Speed: {(manager.currentSpeed / 1024 / 1024).toFixed(2)} MB/s</div>
    <div>Files: {manager.successCount}/{manager.totalFiles}</div>
  </div>

  {#if manager.hasQueuedFiles}
    <div>Queued: {manager.queue.length} files</div>
  {/if}

  {#if manager.hasFailedFiles}
    <div>Failed: {manager.failureCount} files</div>
    <button on:click={() => manager.retryFailed()}>Retry Failed</button>
  {/if}
{/if}
```

## 🔧 Configuration

### UploadManagerConfig

```typescript
interface UploadManagerConfig {
  maxConcurrentUploads: number;    // Default: 4
  chunkSize: number;               // Default: 1MB (1024 * 1024)
  retryAttempts: number;           // Default: 3
  retryDelay: number;              // Default: 1000ms
  autoStart: boolean;              // Default: true
  maxBandwidthMbps?: number;       // Default: 10
  adaptiveBandwidth?: boolean;     // Default: true
  maxMemoryItems?: number;         // Default: 1000
  enablePersistence?: boolean;     // Default: false
  enableSmartScheduling: boolean;  // Default: true
}
```

### UploadManagerOptions (per upload)

```typescript
interface UploadManagerOptions {
  path?: string;                   // Storage path
  metadata?: Record<string, any>;  // Custom metadata
  priority?: number;               // Upload priority
  // ... additional options
}
```

## 📖 API Reference

### Core Methods

```typescript
// File Management
await manager.addFiles(fileList: FileList | File[], options?: UploadManagerOptions): Promise<number>
await manager.addFilesWithValidation(files: File[], options?: ValidationOptions): Promise<ValidationResult>

// Upload Control
await manager.start(): Promise<void>
await manager.pause(): Promise<void>
await manager.resume(): Promise<void>
await manager.stop(): Promise<void>
await manager.destroy(): Promise<void>

// File Operations
await manager.removeFile(fileId: string): Promise<void>
manager.retryFailed(): void
await manager.clearCompleted(): Promise<void>
manager.clearFailed(): void

// Queries
manager.getFile(fileId: string): UploadItem | undefined
manager.getAllFiles(statusFilter?: UploadStatus): UploadItem[]
```

### Validation & Processing

```typescript
// File Validation
await manager.validateFiles(files: File[], rules?: ValidationRule): Promise<Map<File, ValidationResult>>
await manager.validateFile(file: File, rules?: ValidationRule): Promise<ValidationResult>
await manager.detectDuplicates(files: File[]): Promise<Map<string, File[]>>

// Metadata
await manager.getFileMetadata(file: File): Promise<FileMetadata>
```

### Health & Monitoring

```typescript
// Health Checks
await manager.performHealthCheck(): Promise<HealthCheckResult>
await manager.startWithHealthCheck(): Promise<{ canStart: boolean; healthResult: HealthCheckResult }>
manager.getHealthStatus(): HealthStatus

// Performance
manager.getBandwidthStats(): BandwidthStats
manager.getNetworkQuality(): 'excellent' | 'good' | 'poor' | 'unknown'
manager.getRecommendedSettings(): RecommendedSettings
```

### Plugin System

```typescript
// Plugin Management
await manager.registerPlugin(plugin: UploadPlugin, config?: PluginConfig): Promise<void>
await manager.unregisterPlugin(pluginName: string): Promise<void>
manager.getAllPlugins(): PluginInfo[]
manager.getEnabledPlugins(): PluginInfo[]
await manager.setPluginEnabled(pluginName: string, enabled: boolean): Promise<void>
```

## 🔌 Plugin System

The upload manager includes a powerful plugin system for extending functionality. Several production-ready plugins are included:

### Example Plugins

The library includes comprehensive example plugins that demonstrate the plugin system capabilities. These are provided as documentation and examples to copy/customize for your needs:

**Available Examples:**
- **LoggingPlugin** - Debug and monitor uploads with configurable log levels
- **AnalyticsPlugin** - Track performance metrics and success rates  
- **FileProcessingPlugin** - Compress and resize images before upload
- **ValidationEnhancementPlugin** - Advanced security checks with file signature validation
- **QueueOptimizationPlugin** - Optimize upload order for better user experience

**Usage:**
Copy the plugin code from `src/lib/plugins/example-plugins.svelte.ts` in the repository and customize for your needs:

```typescript
// Copy and customize from the examples
class MyCustomLoggingPlugin implements UploadPlugin {
  name = 'my-logging';
  version = '1.0.0';
  description = 'My custom logging implementation';

  // Copy implementation from LoggingPlugin example and customize...
}

await manager.registerPlugin(new MyCustomLoggingPlugin());
```

### Creating Custom Plugins

```typescript
import type { UploadPlugin, UploadItem } from 'svelte-firebase-upload';

export class CustomPlugin implements UploadPlugin {
  name = 'custom-plugin';
  version = '1.0.0';
  description = 'My custom plugin';

  async onInitialize(manager: UploadManagerInterface): Promise<void> {
    console.log('Plugin initialized');
  }

  async onUploadComplete(item: UploadItem, result: any): Promise<void> {
    console.log(`Upload completed: ${item.file.name}`);
    // Custom logic here
  }

  async onUploadError(item: UploadItem, error: Error): Promise<void> {
    console.log(`Upload failed: ${item.file.name}`, error);
    // Custom error handling
  }
}

// Register your plugin
await manager.registerPlugin(new CustomPlugin());
```

## 🎯 Advanced Usage

### Validation with Custom Rules

```typescript
const validationResult = await manager.addFilesWithValidation(files, {
  validate: true,
  validationRules: {
    maxSize: 50 * 1024 * 1024, // 50MB
    allowedTypes: ['image/jpeg', 'image/png', 'application/pdf'],
    customValidator: async (file: File) => {
      // Custom validation logic
      return file.name.length < 100;
    }
  },
  skipDuplicates: true,
  checkResume: true
});

console.log(`Added: ${validationResult.added}, Duplicates: ${validationResult.duplicates}`);
```

### Resumable Uploads

```typescript
// Check for resumable uploads on initialization
await manager.resumeIncompleteUploads();

// Check specific file
const resumeState = await manager.checkForResumableUpload(file);
if (resumeState) {
  console.log(`Can resume upload: ${resumeState.uploadedBytes}/${resumeState.fileSize} bytes`);
}
```

### Memory-Efficient Large Batches

```typescript
// Automatically handles large file sets efficiently
const files = Array.from(document.querySelector('input[type="file"]')!.files!);
if (files.length > 1000) {
  // Uses virtual queuing automatically
  await manager.addFiles(files, {
    path: 'bulk-upload/',
    maxMemoryItems: 500 // Process in batches of 500
  });
}
```

### Health Monitoring

```typescript
// Check health before starting critical uploads
const { canStart, healthResult } = await manager.startWithHealthCheck();
if (!canStart) {
  console.warn('Health issues detected:', healthResult.status.issues);
  // Handle health issues
}

// Monitor health during uploads
const healthStatus = manager.getHealthStatus();
if (!healthStatus.healthy) {
  console.warn('Upload health degraded:', healthStatus.issues);
}
```

## 🏗️ Architecture

### Core Components

1. **FirebaseUploadManager** - Main upload orchestrator
2. **MemoryManager** - Virtual queuing for large file sets
3. **NetworkManager** - Network monitoring and retry logic  
4. **BandwidthManager** - Adaptive bandwidth throttling
5. **FileValidator** - Comprehensive file validation
6. **UploadResumer** - Resumable upload state management
7. **PluginSystem** - Extensible plugin architecture

### State Management

The manager uses Svelte 5's reactive system with `$state()` and `$derived()`:

```typescript
// Reactive properties
manager.totalProgress    // Derived from uploaded/total size
manager.isActive         // Derived from active uploads
manager.hasQueuedFiles   // Derived from queue length
manager.averageSpeed     // Derived from speed samples
```

### Memory Management

For large file sets (>100 files), the manager automatically:
- Uses virtual queuing to prevent memory exhaustion
- Processes files in configurable batches
- Persists state to localStorage when enabled
- Lazily loads file metadata as needed

## 🧪 Testing

```bash
npm test        # Run test suite
npm run test:watch    # Watch mode
npm run test:coverage # Coverage report
```

## 🚀 Building

```bash
npm run build   # Build library
npm run package # Create distributable package
```

## 📄 TypeScript Support

Full TypeScript support with comprehensive type definitions:

```typescript
import type {
  FirebaseUploadManager,
  UploadManagerConfig,
  UploadManagerOptions,
  UploadItem,
  UploadStatus,
  ValidationRule,
  ValidationResult,
  HealthCheckResult,
  UploadPlugin,
  PluginConfig
} from 'svelte-firebase-upload';
```

## 🤝 Contributing

We welcome contributions! Please:

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push to branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/code-gio/svelte-firebase-upload.git
cd svelte-firebase-upload
npm install
npm run dev
```

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- Firebase team for the excellent Storage SDK
- Svelte team for the amazing framework
- Contributors and community feedback

## 📞 Support

- 🐛 **Issues**: [GitHub Issues](https://github.com/code-gio/svelte-firebase-upload/issues)
- 💬 **Discussions**: [GitHub Discussions](https://github.com/code-gio/svelte-firebase-upload/discussions)
- 📧 **Email**: [support@your-domain.com](mailto:support@your-domain.com)

---

**Made with ❤️ for the Svelte community**
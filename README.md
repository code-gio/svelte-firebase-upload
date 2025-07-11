# Svelte Firebase Upload Manager

A robust, feature-rich file upload component for Svelte applications integrated with Firebase Storage. Supports drag-and-drop, progress tracking, resumable uploads, validation, health checks, and more.

## Features

- **Drag & Drop Interface**: Intuitive file selection with visual feedback.
- **Concurrent Uploads**: Upload multiple files simultaneously with configurable limits.
- **Progress Tracking**: Real-time progress bars, speed, and ETA estimates.
- **Resumable Uploads**: Automatic retry and resumption for interrupted uploads.
- **File Validation**: Size, type, and custom validation rules.
- **Smart Scheduling**: Prioritizes smaller files for quicker wins.
- **Health Monitoring**: Periodic checks for network, storage, and permissions.
- **Bandwidth Management**: Adaptive throttling to prevent overload.
- **Plugin System**: Extensible with custom plugins for additional functionality.
- **Memory Optimization**: Handles large batches (>100 files) efficiently.

## Installation

Install the package and its dependencies via npm:

```bash
npm i svelte-firebase-upload firebase
```

This installs the core upload manager and Firebase SDK.

## Usage

### 1. Initialize Firebase

Create a Firebase project and get your config from the Firebase console. In your Svelte component (e.g., `+page.svelte`):

```svelte
<script lang="ts">
  import { initializeApp } from 'firebase/app';
  import { getStorage } from 'firebase/storage';
  import DragAndDrop from 'svelte-firebase-upload/drag-and-drop.svelte'; // Adjust path if needed

  const firebaseConfig = {
    // Your Firebase config here
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  };

  let storage;

  $effect(() => {
    const app = initializeApp(firebaseConfig);
    storage = getStorage(app);
  });
</script>

<DragAndDrop
  {storage}
  uploadPath="uploads/"
  autoStart={true}
  maxFileSize={50 * 1024 * 1024} // 50MB
  allowedFileTypes={['.jpg', '.png', '.pdf']} // Customize as needed
/>
```

### 2. Basic Example

Drop the `<DragAndDrop>` component into your page. It handles file drops, uploads to Firebase Storage, and displays progress/lists.

For advanced usage, access the underlying `FirebaseUploadManager` instance for custom control (e.g., pause/resume).

### Configuration Options

Props for `<DragAndDrop>`:

- `storage`: Firebase Storage instance (required).
- `uploadPath`: Base path in Storage (default: 'uploads/').
- `autoStart`: Start uploads automatically (default: true).
- `maxFileSize`: Max file size in bytes (default: 50MB).
- `allowedFileTypes`: Array of extensions/mimes (default: images).
- `showFileTypeError`: Show errors for invalid types (default: true).

Manager config (passed internally, customizable via extension):

- `maxConcurrentUploads`: Default 4.
- `chunkSize`: Default 1MB.
- `retryAttempts`: Default 3.
- `enableSmartScheduling`: Default true.
- `maxBandwidthMbps`: Default 10.
- And more (see source for full options).

## Dependencies

- Svelte 5+ (for reactivity with `$state`, etc.).
- Firebase SDK 9+.

## Development

- Clone the repo: `git clone [repo-url]`
- Install: `npm install`
- Run dev: `npm run dev`

## License

MIT License. See [LICENSE](LICENSE) for details.

## Contributing

Pull requests welcome! For major changes, open an issue first.

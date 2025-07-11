<script lang="ts">
	import { initializeApp } from 'firebase/app';
	import { getStorage } from 'firebase/storage';
	import DragAndDrop from '$lib/components/drag-and-drop.svelte';

	// Firebase configuration - replace with your actual config
	const firebaseConfig = {
		apiKey: 'AIzaSyBYkaXkWiYBQGLxBDsJHdcUGQcA_eEAhAE',
		authDomain: 'enfogram-cf667.firebaseapp.com',
		projectId: 'enfogram-cf667',
		storageBucket: 'enfogram-cf667.firebasestorage.app',
		messagingSenderId: '284312044274',
		appId: '1:284312044274:web:ba5728012adb9ed0a0066b',
		measurementId: 'G-PMMG8PTVQ0'
	};

	let storage: any = $state(null);
	let error: string | null = $state(null);
	let isInitialized = $state(false);

	// Initialize Firebase
	async function initializeFirebase() {
		try {
			const app = initializeApp(firebaseConfig);
			storage = getStorage(app);
			isInitialized = true;
		} catch (err) {
			error = 'Failed to initialize Firebase. Please check your configuration.';
			console.error('Firebase initialization error:', err);
		}
	}

	// Initialize on component mount
	$effect(() => {
		initializeFirebase();
	});
</script>

<svelte:head>
	<title>Firebase Upload Manager - Drag & Drop Demo</title>
	<meta
		name="description"
		content="Demo of the integrated Firebase upload manager with drag and drop functionality"
	/>
</svelte:head>

<main class="container">
	<header class="header">
		<h1>Firebase Upload Manager</h1>
		<p class="subtitle">Drag & Drop File Upload with Progress Tracking</p>
	</header>

	{#if error}
		<div class="error-banner">
			<div class="error-content">
				<svg class="error-icon" viewBox="0 0 24 24" fill="currentColor">
					<path
						d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"
					/>
				</svg>
				<div class="error-text">
					<h3>Configuration Error</h3>
					<p>{error}</p>
					<p class="error-help">
						Please update the Firebase configuration in <code>src/routes/+page.svelte</code>
					</p>
				</div>
			</div>
		</div>
	{:else if !isInitialized}
		<div class="loading-container">
			<div class="loading-spinner"></div>
			<p>Initializing Firebase...</p>
		</div>
	{:else}
		<div class="upload-section">
			<div class="upload-info">
				<h2>Upload Files</h2>
				<p>Drag and drop files here or click to browse. Supported formats: CSV, XLS, DOCX</p>
			</div>

			<DragAndDrop
				{storage}
				uploadPath="uploads/"
				autoStart={true}
				allowedFileTypes={['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp', '.ARW']}
			/>
		</div>

		<div class="features-section">
			<h2>Features</h2>
			<div class="features-grid">
				<div class="feature-card">
					<div class="feature-icon">📁</div>
					<h3>Drag & Drop</h3>
					<p>Intuitive drag and drop interface for easy file selection</p>
				</div>
				<div class="feature-card">
					<div class="feature-icon">⚡</div>
					<h3>Smart Scheduling</h3>
					<p>Optimized upload queue with intelligent file ordering</p>
				</div>
				<div class="feature-card">
					<div class="feature-icon">📊</div>
					<h3>Progress Tracking</h3>
					<p>Real-time progress bars and upload statistics</p>
				</div>
				<div class="feature-card">
					<div class="feature-icon">🔄</div>
					<h3>Resume Support</h3>
					<p>Automatic retry and resume for interrupted uploads</p>
				</div>
				<div class="feature-card">
					<div class="feature-icon">🛡️</div>
					<h3>Health Checks</h3>
					<p>Automatic health monitoring and error detection</p>
				</div>
				<div class="feature-card">
					<div class="feature-icon">🎛️</div>
					<h3>Upload Controls</h3>
					<p>Pause, resume, and stop uploads as needed</p>
				</div>
			</div>
		</div>
	{/if}
</main>

<style>
	.container {
		max-width: 1200px;
		margin: 0 auto;
		padding: 2rem;
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
	}

	.header {
		text-align: center;
		margin-bottom: 3rem;
	}

	.header h1 {
		font-size: 2.5rem;
		font-weight: 700;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.subtitle {
		font-size: 1.125rem;
		color: #6b7280;
		margin: 0;
	}

	.error-banner {
		background: #fef2f2;
		border: 1px solid #fecaca;
		border-radius: 12px;
		padding: 2rem;
		margin-bottom: 2rem;
	}

	.error-content {
		display: flex;
		align-items: flex-start;
		gap: 1rem;
	}

	.error-icon {
		width: 24px;
		height: 24px;
		color: #dc2626;
		flex-shrink: 0;
		margin-top: 2px;
	}

	.error-text h3 {
		color: #dc2626;
		font-size: 1.125rem;
		font-weight: 600;
		margin: 0 0 0.5rem 0;
	}

	.error-text p {
		color: #7f1d1d;
		margin: 0 0 0.5rem 0;
	}

	.error-help {
		font-size: 0.875rem;
		color: #991b1b;
	}

	.error-help code {
		background: #fecaca;
		padding: 0.125rem 0.25rem;
		border-radius: 4px;
		font-family: 'Monaco', 'Menlo', monospace;
	}

	.loading-container {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		padding: 4rem 2rem;
	}

	.loading-spinner {
		width: 40px;
		height: 40px;
		border: 4px solid #e5e7eb;
		border-top: 4px solid #3b82f6;
		border-radius: 50%;
		animation: spin 1s linear infinite;
		margin-bottom: 1rem;
	}

	@keyframes spin {
		0% {
			transform: rotate(0deg);
		}
		100% {
			transform: rotate(360deg);
		}
	}

	.upload-section {
		margin-bottom: 4rem;
	}

	.upload-info {
		text-align: center;
		margin-bottom: 2rem;
	}

	.upload-info h2 {
		font-size: 1.5rem;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.upload-info p {
		color: #6b7280;
		margin: 0;
	}

	.features-section {
		margin-top: 4rem;
	}

	.features-section h2 {
		text-align: center;
		font-size: 1.875rem;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 2rem;
	}

	.features-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
		gap: 1.5rem;
	}

	.feature-card {
		background: white;
		border: 1px solid #e5e7eb;
		border-radius: 12px;
		padding: 1.5rem;
		text-align: center;
		transition: all 0.2s ease;
	}

	.feature-card:hover {
		border-color: #3b82f6;
		box-shadow: 0 4px 12px rgba(59, 130, 246, 0.1);
	}

	.feature-icon {
		font-size: 2rem;
		margin-bottom: 1rem;
	}

	.feature-card h3 {
		font-size: 1.125rem;
		font-weight: 600;
		color: #1f2937;
		margin-bottom: 0.5rem;
	}

	.feature-card p {
		color: #6b7280;
		font-size: 0.875rem;
		line-height: 1.5;
		margin: 0;
	}

	@media (max-width: 768px) {
		.container {
			padding: 1rem;
		}

		.header h1 {
			font-size: 2rem;
		}

		.features-grid {
			grid-template-columns: 1fr;
		}
	}
</style>

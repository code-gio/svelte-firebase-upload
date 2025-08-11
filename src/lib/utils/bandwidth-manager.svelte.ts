import type { BandwidthConfig, ThrottleInfo } from '../types.js';

export class BandwidthManager {
	private _config: BandwidthConfig;
	private _throttleInfo: ThrottleInfo;
	private _isThrottling = false;
	private _uploadQueue: Array<() => void> = [];
	private _currentBandwidth = 0;
	private _bandwidthHistory: number[] = [];
	private _throttleTimeout?: NodeJS.Timeout;

	constructor(config: Partial<BandwidthConfig> = {}) {
		this._config = this._validateConfig({
			maxBandwidthMbps: 10, // 10 Mbps default
			adaptiveBandwidth: true,
			throttleInterval: 100, // 100ms intervals
			...config
		});

		this._throttleInfo = {
			bytesPerSecond: 0,
			lastUpdate: Date.now(),
			queue: []
		};
	}

	private _validateConfig(config: BandwidthConfig): BandwidthConfig {
		const warnings: string[] = [];
		
		// Validate maxBandwidthMbps
		if (typeof config.maxBandwidthMbps !== 'number' || config.maxBandwidthMbps < 0.1) {
			warnings.push('maxBandwidthMbps must be at least 0.1');
			config.maxBandwidthMbps = Math.max(0.1, config.maxBandwidthMbps || 10);
		} else if (config.maxBandwidthMbps > 1000) {
			warnings.push('maxBandwidthMbps exceeds reasonable maximum (1000 Mbps)');
			config.maxBandwidthMbps = 1000;
		}

		// Validate throttleInterval
		if (typeof config.throttleInterval !== 'number' || config.throttleInterval < 10) {
			warnings.push('throttleInterval must be at least 10ms');
			config.throttleInterval = Math.max(10, config.throttleInterval || 100);
		} else if (config.throttleInterval > 5000) {
			warnings.push('throttleInterval exceeds recommended maximum (5000ms)');
			config.throttleInterval = 5000;
		}

		// Validate adaptiveBandwidth
		if (typeof config.adaptiveBandwidth !== 'boolean') {
			warnings.push('adaptiveBandwidth must be a boolean');
			config.adaptiveBandwidth = true;
		}

		// Log warnings
		if (warnings.length > 0) {
			console.warn('[BandwidthManager] Configuration warnings:', warnings);
		}

		return config;
	}

	// Throttle upload based on bandwidth limits
	async throttleUpload(bytesToUpload: number): Promise<void> {
		if (!this._isThrottling) {
			this._isThrottling = true;
			this._startThrottling();
		}

		return new Promise((resolve) => {
			this._uploadQueue.push(() => {
				this._processUpload(bytesToUpload);
				resolve();
			});
		});
	}

	// Update bandwidth usage
	updateBandwidthUsage(bytesUploaded: number, timeMs: number): void {
		const bytesPerSecond = (bytesUploaded / timeMs) * 1000;
		this._currentBandwidth = bytesPerSecond;

		// Keep history for adaptive bandwidth
		this._bandwidthHistory.push(bytesPerSecond);
		if (this._bandwidthHistory.length > 10) {
			this._bandwidthHistory.shift();
		}

		// Update throttle info
		this._throttleInfo.bytesPerSecond = bytesPerSecond;
		this._throttleInfo.lastUpdate = Date.now();
	}

	// Get current bandwidth usage
	getCurrentBandwidth(): number {
		return this._currentBandwidth;
	}

	// Get average bandwidth over time
	getAverageBandwidth(): number {
		if (this._bandwidthHistory.length === 0) return 0;

		const sum = this._bandwidthHistory.reduce((a, b) => a + b, 0);
		return sum / this._bandwidthHistory.length;
	}

	// Check if we're within bandwidth limits
	isWithinLimits(): boolean {
		const maxBytesPerSecond = (this._config.maxBandwidthMbps * 1024 * 1024) / 8; // Convert Mbps to bytes/s
		return this._currentBandwidth <= maxBytesPerSecond;
	}

	// Adaptive bandwidth adjustment
	adjustBandwidth(): void {
		if (!this._config.adaptiveBandwidth) return;

		const maxBytesPerSecond = (this._config.maxBandwidthMbps * 1024 * 1024) / 8;
		const averageBandwidth = this.getAverageBandwidth();

		// If we're consistently under the limit, we can increase
		if (averageBandwidth < maxBytesPerSecond * 0.8) {
			this._config.maxBandwidthMbps = Math.min(
				this._config.maxBandwidthMbps * 1.1,
				this._config.maxBandwidthMbps * 2 // Don't double it
			);
		}
		// If we're consistently over the limit, decrease
		else if (averageBandwidth > maxBytesPerSecond * 0.95) {
			this._config.maxBandwidthMbps = Math.max(
				this._config.maxBandwidthMbps * 0.9,
				this._config.maxBandwidthMbps * 0.5 // Don't halve it
			);
		}
	}

	// Set bandwidth limit
	setBandwidthLimit(mbps: number): void {
		this._config.maxBandwidthMbps = mbps;
	}

	// Get recommended chunk size based on bandwidth
	getRecommendedChunkSize(): number {
		const maxBytesPerSecond = (this._config.maxBandwidthMbps * 1024 * 1024) / 8;
		const chunkTime = 2; // 2 seconds per chunk
		return Math.min(maxBytesPerSecond * chunkTime, 5 * 1024 * 1024); // Max 5MB
	}

	// Pause throttling
	pause(): void {
		this._isThrottling = false;
	}

	// Resume throttling
	resume(): void {
		if (!this._isThrottling) {
			this._isThrottling = true;
			this._startThrottling();
		}
	}

	// Cleanup and destroy
	destroy(): void {
		this._isThrottling = false;
		
		// Clear timeout
		if (this._throttleTimeout) {
			clearTimeout(this._throttleTimeout);
			this._throttleTimeout = undefined;
		}
		
		// Clear queues and history
		this._uploadQueue.length = 0;
		this._bandwidthHistory.length = 0;
		this._currentBandwidth = 0;
		
		// Reset throttle info
		this._throttleInfo = {
			bytesPerSecond: 0,
			lastUpdate: Date.now(),
			queue: []
		};
	}

	// Get bandwidth statistics
	getBandwidthStats(): {
		current: number;
		average: number;
		peak: number;
		limit: number;
		utilization: number;
	} {
		const maxBytesPerSecond = (this._config.maxBandwidthMbps * 1024 * 1024) / 8;
		const peak = Math.max(...this._bandwidthHistory, 0);
		const utilization =
			maxBytesPerSecond > 0 ? (this._currentBandwidth / maxBytesPerSecond) * 100 : 0;

		return {
			current: this._currentBandwidth,
			average: this.getAverageBandwidth(),
			peak,
			limit: maxBytesPerSecond,
			utilization
		};
	}

	// Private methods
	private _startThrottling(): void {
		const processQueue = () => {
			if (!this._isThrottling) return;

			const maxBytesPerSecond = (this._config.maxBandwidthMbps * 1024 * 1024) / 8;
			const now = Date.now();
			const timeDiff = now - this._throttleInfo.lastUpdate;

			// Calculate how many bytes we can process
			const bytesAllowed = (maxBytesPerSecond * timeDiff) / 1000;

			if (this._throttleInfo.bytesPerSecond <= bytesAllowed && this._uploadQueue.length > 0) {
				const upload = this._uploadQueue.shift();
				if (upload) {
					upload();
				}
			}

			this._throttleInfo.lastUpdate = now;

			// Continue throttling
			this._throttleTimeout = setTimeout(processQueue, this._config.throttleInterval);
		};

		processQueue();
	}

	private _processUpload(bytes: number): void {
		// Update throttle info
		this._throttleInfo.bytesPerSecond += bytes;

		// Reset after a second
		setTimeout(() => {
			this._throttleInfo.bytesPerSecond = Math.max(0, this._throttleInfo.bytesPerSecond - bytes);
		}, 1000);
	}
}

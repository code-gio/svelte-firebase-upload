import type { BandwidthConfig, ThrottleInfo } from '../types.js';

export class BandwidthManager {
	private config: BandwidthConfig;
	private throttleInfo: ThrottleInfo;
	private isThrottling = false;
	private uploadQueue: Array<() => void> = [];
	private currentBandwidth = 0;
	private bandwidthHistory: number[] = [];

	constructor(config: Partial<BandwidthConfig> = {}) {
		console.log('[BandwidthManager] Initialized with config:', config);
		this.config = {
			maxBandwidthMbps: 10, // 10 Mbps default
			adaptiveBandwidth: true,
			throttleInterval: 100, // 100ms intervals
			...config
		};

		this.throttleInfo = {
			bytesPerSecond: 0,
			lastUpdate: Date.now(),
			queue: []
		};
	}

	// Throttle upload based on bandwidth limits
	async throttleUpload(bytesToUpload: number): Promise<void> {
		console.log(`[BandwidthManager] throttleUpload called for ${bytesToUpload} bytes`);
		if (!this.isThrottling) {
			this.isThrottling = true;
			this._startThrottling();
		}

		return new Promise((resolve) => {
			this.uploadQueue.push(() => {
				this._processUpload(bytesToUpload);
				resolve();
			});
		});
	}

	// Update bandwidth usage
	updateBandwidthUsage(bytesUploaded: number, timeMs: number): void {
		console.log(
			`[BandwidthManager] updateBandwidthUsage called: ${bytesUploaded} bytes over ${timeMs}ms`
		);
		const bytesPerSecond = (bytesUploaded / timeMs) * 1000;
		this.currentBandwidth = bytesPerSecond;

		// Keep history for adaptive bandwidth
		this.bandwidthHistory.push(bytesPerSecond);
		if (this.bandwidthHistory.length > 10) {
			this.bandwidthHistory.shift();
		}

		// Update throttle info
		this.throttleInfo.bytesPerSecond = bytesPerSecond;
		this.throttleInfo.lastUpdate = Date.now();
	}

	// Get current bandwidth usage
	getCurrentBandwidth(): number {
		return this.currentBandwidth;
	}

	// Get average bandwidth over time
	getAverageBandwidth(): number {
		if (this.bandwidthHistory.length === 0) return 0;

		const sum = this.bandwidthHistory.reduce((a, b) => a + b, 0);
		return sum / this.bandwidthHistory.length;
	}

	// Check if we're within bandwidth limits
	isWithinLimits(): boolean {
		const maxBytesPerSecond = (this.config.maxBandwidthMbps * 1024 * 1024) / 8; // Convert Mbps to bytes/s
		return this.currentBandwidth <= maxBytesPerSecond;
	}

	// Adaptive bandwidth adjustment
	adjustBandwidth(): void {
		if (!this.config.adaptiveBandwidth) return;

		const maxBytesPerSecond = (this.config.maxBandwidthMbps * 1024 * 1024) / 8;
		const averageBandwidth = this.getAverageBandwidth();

		// If we're consistently under the limit, we can increase
		if (averageBandwidth < maxBytesPerSecond * 0.8) {
			this.config.maxBandwidthMbps = Math.min(
				this.config.maxBandwidthMbps * 1.1,
				this.config.maxBandwidthMbps * 2 // Don't double it
			);
		}
		// If we're consistently over the limit, decrease
		else if (averageBandwidth > maxBytesPerSecond * 0.95) {
			this.config.maxBandwidthMbps = Math.max(
				this.config.maxBandwidthMbps * 0.9,
				this.config.maxBandwidthMbps * 0.5 // Don't halve it
			);
		}
	}

	// Set bandwidth limit
	setBandwidthLimit(mbps: number): void {
		this.config.maxBandwidthMbps = mbps;
	}

	// Get recommended chunk size based on bandwidth
	getRecommendedChunkSize(): number {
		const maxBytesPerSecond = (this.config.maxBandwidthMbps * 1024 * 1024) / 8;
		const chunkTime = 2; // 2 seconds per chunk
		return Math.min(maxBytesPerSecond * chunkTime, 5 * 1024 * 1024); // Max 5MB
	}

	// Pause throttling
	pause(): void {
		this.isThrottling = false;
	}

	// Resume throttling
	resume(): void {
		if (!this.isThrottling) {
			this.isThrottling = true;
			this._startThrottling();
		}
	}

	// Get bandwidth statistics
	getBandwidthStats(): {
		current: number;
		average: number;
		peak: number;
		limit: number;
		utilization: number;
	} {
		console.log('[BandwidthManager] getBandwidthStats called');
		const maxBytesPerSecond = (this.config.maxBandwidthMbps * 1024 * 1024) / 8;
		const peak = Math.max(...this.bandwidthHistory, 0);
		const utilization =
			maxBytesPerSecond > 0 ? (this.currentBandwidth / maxBytesPerSecond) * 100 : 0;

		return {
			current: this.currentBandwidth,
			average: this.getAverageBandwidth(),
			peak,
			limit: maxBytesPerSecond,
			utilization
		};
	}

	// Private methods
	private _startThrottling(): void {
		const processQueue = () => {
			if (!this.isThrottling) return;

			const maxBytesPerSecond = (this.config.maxBandwidthMbps * 1024 * 1024) / 8;
			const now = Date.now();
			const timeDiff = now - this.throttleInfo.lastUpdate;

			// Calculate how many bytes we can process
			const bytesAllowed = (maxBytesPerSecond * timeDiff) / 1000;

			if (this.throttleInfo.bytesPerSecond <= bytesAllowed && this.uploadQueue.length > 0) {
				const upload = this.uploadQueue.shift();
				if (upload) {
					upload();
				}
			}

			this.throttleInfo.lastUpdate = now;

			// Continue throttling
			setTimeout(processQueue, this.config.throttleInterval);
		};

		processQueue();
	}

	private _processUpload(bytes: number): void {
		// Update throttle info
		this.throttleInfo.bytesPerSecond += bytes;

		// Reset after a second
		setTimeout(() => {
			this.throttleInfo.bytesPerSecond = Math.max(0, this.throttleInfo.bytesPerSecond - bytes);
		}, 1000);
	}
}

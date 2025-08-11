import type { UploadManagerConfig, UploadManagerOptions } from '../types.js';

// Configuration validation result
export interface ConfigValidationResult {
	valid: boolean;
	errors: string[];
	warnings: string[];
	sanitized?: UploadManagerConfig;
}

// Configuration constraints
export interface ConfigConstraints {
	maxConcurrentUploads: { min: number; max: number; default: number };
	chunkSize: { min: number; max: number; default: number };
	retryAttempts: { min: number; max: number; default: number };
	retryDelay: { min: number; max: number; default: number };
	maxBandwidthMbps: { min: number; max: number; default: number };
	maxMemoryItems: { min: number; max: number; default: number };
}

/**
 * Configuration validator for upload manager settings.
 * 
 * Provides comprehensive validation of configuration options with:
 * - Type checking and conversion
 * - Range validation with automatic clamping
 * - Cross-validation between related settings
 * - Detailed error and warning reporting
 * 
 * @example
 * ```typescript
 * const validator = new ConfigValidator();
 * const result = validator.validateConfig({
 *   maxConcurrentUploads: 10,
 *   chunkSize: '5MB', // Will be converted and warned
 *   retryAttempts: -1   // Will be clamped to minimum
 * });
 * 
 * if (result.valid) {
 *   // Use result.sanitized for clean configuration
 * }
 * ```
 */
export class ConfigValidator {
	private static readonly DEFAULT_CONSTRAINTS: ConfigConstraints = {
		maxConcurrentUploads: { min: 1, max: 50, default: 5 },
		chunkSize: { min: 1024 * 64, max: 1024 * 1024 * 100, default: 1024 * 1024 * 5 }, // 64KB - 100MB, default 5MB
		retryAttempts: { min: 0, max: 10, default: 3 },
		retryDelay: { min: 100, max: 60000, default: 1000 }, // 100ms - 60s, default 1s
		maxBandwidthMbps: { min: 0.1, max: 1000, default: 10 },
		maxMemoryItems: { min: 10, max: 100000, default: 1000 }
	};

	constructor(private constraints: ConfigConstraints = ConfigValidator.DEFAULT_CONSTRAINTS) {}

	/**
	 * Validate and sanitize configuration options.
	 * 
	 * @param options - Configuration options to validate
	 * @returns Validation result with sanitized configuration
	 * 
	 * @example
	 * ```typescript
	 * const result = validator.validateConfig({
	 *   maxConcurrentUploads: 15, // Will be clamped to max (10)
	 *   chunkSize: 1000,          // Will be increased to min (64KB)
	 *   autoStart: 'true'         // Will cause validation error
	 * });
	 * 
	 * console.log(result.warnings); // ['maxConcurrentUploads exceeds maximum...']
	 * console.log(result.errors);   // ['autoStart must be a boolean']
	 * ```
	 */
	validateConfig(options: UploadManagerOptions = {}): ConfigValidationResult {
		const errors: string[] = [];
		const warnings: string[] = [];
		
		// Create sanitized config with defaults (mutable version)
		const sanitized: any = {
			maxConcurrentUploads: this.constraints.maxConcurrentUploads.default,
			chunkSize: this.constraints.chunkSize.default,
			retryAttempts: this.constraints.retryAttempts.default,
			retryDelay: this.constraints.retryDelay.default,
			autoStart: false,
			enableSmartScheduling: false
		};

		// Validate maxConcurrentUploads
		if (options.maxConcurrentUploads !== undefined) {
			const result = this.validateNumber(
				'maxConcurrentUploads',
				options.maxConcurrentUploads,
				this.constraints.maxConcurrentUploads
			);
			sanitized.maxConcurrentUploads = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}

		// Validate chunkSize
		if (options.chunkSize !== undefined) {
			const result = this.validateNumber(
				'chunkSize',
				options.chunkSize,
				this.constraints.chunkSize
			);
			sanitized.chunkSize = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);

			// Special warning for very large chunks
			if (result.value > 50 * 1024 * 1024) {
				warnings.push('Very large chunk size may cause memory issues on mobile devices');
			}
		}

		// Validate retryAttempts
		if (options.retryAttempts !== undefined) {
			const result = this.validateNumber(
				'retryAttempts',
				options.retryAttempts,
				this.constraints.retryAttempts
			);
			sanitized.retryAttempts = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}

		// Validate retryDelay
		if (options.retryDelay !== undefined) {
			const result = this.validateNumber(
				'retryDelay',
				options.retryDelay,
				this.constraints.retryDelay
			);
			sanitized.retryDelay = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}

		// Validate boolean options
		if (options.autoStart !== undefined) {
			if (typeof options.autoStart !== 'boolean') {
				errors.push('autoStart must be a boolean');
			} else {
				sanitized.autoStart = options.autoStart;
			}
		}

		if (options.enableSmartScheduling !== undefined) {
			if (typeof options.enableSmartScheduling !== 'boolean') {
				errors.push('enableSmartScheduling must be a boolean');
			} else {
				sanitized.enableSmartScheduling = options.enableSmartScheduling;
			}
		}

		// Validate optional bandwidth settings
		if (options.maxBandwidthMbps !== undefined) {
			const result = this.validateNumber(
				'maxBandwidthMbps',
				options.maxBandwidthMbps,
				this.constraints.maxBandwidthMbps
			);
			sanitized.maxBandwidthMbps = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}

		if (options.adaptiveBandwidth !== undefined) {
			if (typeof options.adaptiveBandwidth !== 'boolean') {
				errors.push('adaptiveBandwidth must be a boolean');
			} else {
				sanitized.adaptiveBandwidth = options.adaptiveBandwidth;
			}
		}

		// Validate optional memory settings
		if (options.maxMemoryItems !== undefined) {
			const result = this.validateNumber(
				'maxMemoryItems',
				options.maxMemoryItems,
				this.constraints.maxMemoryItems
			);
			sanitized.maxMemoryItems = result.value;
			errors.push(...result.errors);
			warnings.push(...result.warnings);
		}

		if (options.enablePersistence !== undefined) {
			if (typeof options.enablePersistence !== 'boolean') {
				errors.push('enablePersistence must be a boolean');
			} else {
				sanitized.enablePersistence = options.enablePersistence;
			}
		}

		if (options.enableHealthChecks !== undefined) {
			if (typeof options.enableHealthChecks !== 'boolean') {
				warnings.push('enableHealthChecks must be a boolean - using default');
			}
			// Note: enableHealthChecks is not part of UploadManagerConfig, it's a constructor option
		}

		// Cross-validation checks
		this.performCrossValidation(sanitized, errors, warnings);

		return {
			valid: errors.length === 0,
			errors,
			warnings,
			sanitized: sanitized as UploadManagerConfig
		};
	}

	private validateNumber(
		fieldName: string, 
		value: any, 
		constraint: { min: number; max: number; default: number }
	): { value: number; errors: string[]; warnings: string[] } {
		const errors: string[] = [];
		const warnings: string[] = [];
		let sanitizedValue = constraint.default;

		if (typeof value !== 'number') {
			if (typeof value === 'string' && !isNaN(Number(value))) {
				const numValue = Number(value);
				warnings.push(`${fieldName} should be a number, not a string. Converting "${value}" to ${numValue}`);
				sanitizedValue = numValue;
			} else {
				errors.push(`${fieldName} must be a number, got ${typeof value}`);
				return { value: constraint.default, errors, warnings };
			}
		} else {
			sanitizedValue = value;
		}

		if (!Number.isFinite(sanitizedValue)) {
			errors.push(`${fieldName} must be a finite number`);
			return { value: constraint.default, errors, warnings };
		}

		if (sanitizedValue < constraint.min) {
			warnings.push(`${fieldName} (${sanitizedValue}) is below minimum (${constraint.min}). Using minimum value.`);
			sanitizedValue = constraint.min;
		} else if (sanitizedValue > constraint.max) {
			warnings.push(`${fieldName} (${sanitizedValue}) exceeds maximum (${constraint.max}). Using maximum value.`);
			sanitizedValue = constraint.max;
		}

		return { value: sanitizedValue, errors, warnings };
	}

	private performCrossValidation(
		config: any, 
		_errors: string[], 
		warnings: string[]
	): void {
		// Check if chunk size is reasonable for concurrent uploads
		const totalMemoryEstimate = config.maxConcurrentUploads * config.chunkSize;
		const maxReasonableMemory = 500 * 1024 * 1024; // 500MB
		
		if (totalMemoryEstimate > maxReasonableMemory) {
			warnings.push(
				`High memory usage expected: ${config.maxConcurrentUploads} concurrent uploads × ${this.formatBytes(config.chunkSize)} chunks ≈ ${this.formatBytes(totalMemoryEstimate)}. Consider reducing maxConcurrentUploads or chunkSize.`
			);
		}

		// Check retry configuration
		const maxRetryTime = config.retryAttempts * config.retryDelay;
		if (maxRetryTime > 300000) { // 5 minutes
			warnings.push(
				`Maximum retry time could exceed 5 minutes (${config.retryAttempts} attempts × ${config.retryDelay}ms delay). Consider reducing retry configuration.`
			);
		}

		// Check for conflicting settings
		if (config.enableSmartScheduling && config.maxConcurrentUploads === 1) {
			warnings.push('Smart scheduling has limited benefit with maxConcurrentUploads=1');
		}
	}

	private formatBytes(bytes: number): string {
		if (bytes === 0) return '0 B';
		const k = 1024;
		const sizes = ['B', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
	}

	// Validate runtime configuration changes
	validateRuntimeChange(
		field: keyof UploadManagerConfig,
		value: any,
		_currentConfig: UploadManagerConfig
	): { valid: boolean; sanitizedValue?: any; error?: string; warning?: string } {
		const constraint = this.constraints[field as keyof ConfigConstraints];
		
		if (!constraint) {
			return { 
				valid: false, 
				error: `Field '${field}' is not configurable at runtime` 
			};
		}

		const result = this.validateNumber(field, value, constraint);
		
		if (result.errors.length > 0) {
			return { 
				valid: false, 
				error: result.errors[0] 
			};
		}

		const warning = result.warnings.length > 0 ? result.warnings[0] : undefined;

		return {
			valid: true,
			sanitizedValue: result.value,
			warning
		};
	}
}
import type { ValidationRule, ValidationResult } from '../types.js';

export class FileValidator {
	constructor() {
		console.log('[FileValidator] Initialized');
	}

	private defaultRules: ValidationRule = {
		maxSize: 100 * 1024 * 1024, // 100MB default
		allowedTypes: ['*/*'] // Allow all types by default
	};

	// Validate a single file against rules
	async validateFile(file: File, rules: Partial<ValidationRule> = {}): Promise<ValidationResult> {
		console.log(`[FileValidator] Validating file: ${file.name}`);
		const mergedRules = { ...this.defaultRules, ...rules };
		const errors: string[] = [];
		const warnings: string[] = [];

		// Size validation
		if (mergedRules.maxSize && file.size > mergedRules.maxSize) {
			errors.push(
				`File size (${this.formatBytes(file.size)}) exceeds maximum allowed size (${this.formatBytes(mergedRules.maxSize)})`
			);
		}

		// Type validation
		if (mergedRules.allowedTypes && mergedRules.allowedTypes.length > 0) {
			const isAllowed = this.isFileTypeAllowed(file, mergedRules.allowedTypes);
			if (!isAllowed) {
				errors.push(
					`File type '${file.type}' is not allowed. Allowed types: ${mergedRules.allowedTypes.join(', ')}`
				);
			}
		}

		// Content validation (virus scan, etc.)
		if (mergedRules.customValidator) {
			try {
				const isValid = await mergedRules.customValidator(file);
				if (!isValid) {
					errors.push('File failed custom validation');
				}
			} catch (error) {
				errors.push(
					`Custom validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
				);
			}
		}

		// Additional checks
		const additionalChecks = await this.performAdditionalChecks(file);
		errors.push(...additionalChecks.errors);
		warnings.push(...additionalChecks.warnings);

		const result: ValidationResult = {
			valid: errors.length === 0,
			errors,
			warnings
		};

		if (!result.valid) {
			console.warn(`[FileValidator] File failed validation: ${file.name}`);
			console.warn(`[FileValidator] Errors: ${result.errors.join(', ')}`);
			console.warn(`[FileValidator] Warnings: ${result.warnings.join(', ')}`);
		}

		return result;
	}

	// Validate multiple files
	async validateFiles(
		files: File[],
		rules: Partial<ValidationRule> = {}
	): Promise<Map<File, ValidationResult>> {
		console.log(`[FileValidator] Validating ${files.length} files`);
		const results = new Map<File, ValidationResult>();

		// Validate files in parallel for better performance
		const validationPromises = files.map(async (file) => {
			const result = await this.validateFile(file, rules);
			results.set(file, result);
		});

		await Promise.all(validationPromises);
		return results;
	}

	// Check for duplicate files based on content hash
	async detectDuplicates(files: File[]): Promise<Map<string, File[]>> {
		console.log(`[FileValidator] Detecting duplicates for ${files.length} files`);
		const hashMap = new Map<string, File[]>();

		for (const file of files) {
			const hash = await this.calculateFileHash(file);
			if (!hashMap.has(hash)) {
				hashMap.set(hash, []);
			}
			hashMap.get(hash)!.push(file);
		}

		// Return only groups with more than one file (duplicates)
		const duplicates = new Map<string, File[]>();
		for (const [hash, fileGroup] of hashMap) {
			if (fileGroup.length > 1) {
				duplicates.set(hash, fileGroup);
			}
		}

		return duplicates;
	}

	// Calculate file hash for duplicate detection
	async calculateFileHash(file: File, algorithm: 'SHA-1' | 'SHA-256' = 'SHA-256'): Promise<string> {
		console.log(`[FileValidator] Calculating hash for file: ${file.name}`);
		const buffer = await file.arrayBuffer();
		const hashBuffer = await crypto.subtle.digest(algorithm, buffer);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		const hash = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
		console.log(`[FileValidator] Hash calculated: ${hash}`);
		return hash;
	}

	// Get file metadata for validation
	async getFileMetadata(file: File): Promise<{
		size: number;
		type: string;
		lastModified: number;
		hash: string;
		dimensions?: { width: number; height: number };
		duration?: number;
	}> {
		console.log(`[FileValidator] Getting metadata for file: ${file.name}`);
		const hash = await this.calculateFileHash(file);
		const metadata: any = {
			size: file.size,
			type: file.type,
			lastModified: file.lastModified,
			hash
		};

		// Get image dimensions if it's an image
		if (file.type.startsWith('image/')) {
			const dimensions = await this.getImageDimensions(file);
			if (dimensions) {
				metadata.dimensions = dimensions;
			}
		}

		// Get video duration if it's a video
		if (file.type.startsWith('video/')) {
			const duration = await this.getVideoDuration(file);
			if (duration) {
				metadata.duration = duration;
			}
		}
		console.log(`[FileValidator] Metadata retrieved for file: ${file.name}`);
		return metadata;
	}

	// Private methods
	private isFileTypeAllowed(file: File, allowedTypes: string[]): boolean {
		console.log(`[FileValidator] Checking if file type '${file.type}' is allowed.`);
		// Handle wildcard types
		if (allowedTypes.includes('*/*')) {
			console.log('[FileValidator] File type "*" is allowed.');
			return true;
		}

		for (const allowedType of allowedTypes) {
			// Exact match
			if (file.type === allowedType) {
				console.log(
					`[FileValidator] File type '${file.type}' matches allowed type: ${allowedType}`
				);
				return true;
			}

			// Wildcard match (e.g., "image/*" matches "image/jpeg")
			if (allowedType.endsWith('/*')) {
				const baseType = allowedType.slice(0, -2);
				if (file.type.startsWith(baseType + '/')) {
					console.log(
						`[FileValidator] File type '${file.type}' matches allowed type (wildcard): ${allowedType}`
					);
					return true;
				}
			}

			// Extension match (e.g., ".pdf" matches "application/pdf")
			if (allowedType.startsWith('.')) {
				const extension = allowedType.toLowerCase();
				if (file.name.toLowerCase().endsWith(extension)) {
					console.log(
						`[FileValidator] File type '${file.type}' matches allowed type (extension): ${allowedType}`
					);
					return true;
				}
			}
		}
		console.log(`[FileValidator] File type '${file.type}' is NOT allowed.`);
		return false;
	}

	private async performAdditionalChecks(
		file: File
	): Promise<{ errors: string[]; warnings: string[] }> {
		console.log(`[FileValidator] Performing additional checks for file: ${file.name}`);
		const errors: string[] = [];
		const warnings: string[] = [];

		// Check for empty files
		if (file.size === 0) {
			errors.push('File is empty');
			console.warn(`[FileValidator] File is empty: ${file.name}`);
		}

		// Check for suspicious file extensions
		const suspiciousExtensions = ['.exe', '.bat', '.cmd', '.scr', '.pif'];
		const fileExtension = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
		if (suspiciousExtensions.includes(fileExtension)) {
			warnings.push(`File has potentially dangerous extension: ${fileExtension}`);
			console.warn(`[FileValidator] File has potentially dangerous extension: ${fileExtension}`);
		}

		// Check for very large files
		if (file.size > 1024 * 1024 * 1024) {
			// 1GB
			warnings.push('File is very large and may take a long time to upload');
			console.warn(
				`[FileValidator] File is very large and may take a long time to upload: ${file.name}`
			);
		}

		return { errors, warnings };
	}

	private async getImageDimensions(file: File): Promise<{ width: number; height: number } | null> {
		console.log(`[FileValidator] Getting image dimensions for file: ${file.name}`);
		return new Promise((resolve) => {
			const img = new Image();
			img.onload = () => {
				console.log(
					`[FileValidator] Image dimensions retrieved for file: ${file.name} (Width: ${img.width}, Height: ${img.height})`
				);
				resolve({ width: img.width, height: img.height });
			};
			img.onerror = () => {
				console.warn(`[FileValidator] Failed to get image dimensions for file: ${file.name}`);
				resolve(null);
			};
			img.src = URL.createObjectURL(file);
		});
	}

	private async getVideoDuration(file: File): Promise<number | null> {
		console.log(`[FileValidator] Getting video duration for file: ${file.name}`);
		return new Promise((resolve) => {
			const video = document.createElement('video');
			video.onloadedmetadata = () => {
				console.log(
					`[FileValidator] Video duration retrieved for file: ${file.name} (Duration: ${video.duration})`
				);
				resolve(video.duration);
			};
			video.onerror = () => {
				console.warn(`[FileValidator] Failed to get video duration for file: ${file.name}`);
				resolve(null);
			};
			video.src = URL.createObjectURL(file);
		});
	}

	private formatBytes(bytes: number): string {
		console.log(`[FileValidator] Formatting bytes: ${bytes}`);
		if (bytes === 0) return '0 Bytes';
		const k = 1024;
		const sizes = ['Bytes', 'KB', 'MB', 'GB'];
		const i = Math.floor(Math.log(bytes) / Math.log(k));
		const formattedBytes = parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
		console.log(`[FileValidator] Formatted bytes: ${formattedBytes}`);
		return formattedBytes;
	}
}

import * as path from "path"
import * as fs from "fs/promises"
import ignore, { Ignore } from "ignore"

/**
 * Shared utilities for handling .gitignore and .rooignore files across different services.
 * This ensures consistent ignore behavior between list-files and code indexing.
 */

/**
 * Find all ignore files of a specific type from the given directory up to the workspace root
 * @param startPath - Starting directory path
 * @param ignoreFileName - Name of the ignore file (e.g., '.gitignore', '.rooignore')
 * @returns Array of ignore file paths in order (root first, then more specific)
 */
export async function findIgnoreFiles(startPath: string, ignoreFileName: string): Promise<string[]> {
	const ignoreFiles: string[] = []
	let currentPath = path.resolve(startPath)

	// Walk up the directory tree looking for ignore files
	while (currentPath && currentPath !== path.dirname(currentPath)) {
		const ignoreFilePath = path.join(currentPath, ignoreFileName)

		try {
			await fs.access(ignoreFilePath)
			ignoreFiles.push(ignoreFilePath)
		} catch {
			// Ignore file doesn't exist at this level, continue
		}

		// Move up one directory
		const parentPath = path.dirname(currentPath)
		if (parentPath === currentPath) {
			break // Reached root
		}
		currentPath = parentPath
	}

	// Return in reverse order (root ignore file first, then more specific ones)
	return ignoreFiles.reverse()
}

/**
 * Find ignore files both up the directory tree and down in subdirectories
 * @param startPath - Starting directory path
 * @param ignoreFileName - Name of the ignore file
 * @returns Array of ignore file paths
 */
async function findAllIgnoreFilesInTree(startPath: string, ignoreFileName: string): Promise<string[]> {
	const allFiles: string[] = []
	const absolutePath = path.resolve(startPath)

	// First, get parent ignore files (walking up)
	const parentFiles = await findIgnoreFiles(absolutePath, ignoreFileName)
	allFiles.push(...parentFiles)

	// Then, scan subdirectories for ignore files
	async function scanSubdirectories(dirPath: string): Promise<void> {
		try {
			const entries = await fs.readdir(dirPath, { withFileTypes: true })

			for (const entry of entries) {
				if (entry.isDirectory() && !entry.name.startsWith(".")) {
					const subDirPath = path.join(dirPath, entry.name)
					const ignoreFilePath = path.join(subDirPath, ignoreFileName)

					try {
						await fs.access(ignoreFilePath)
						// Only add if not already in parent files
						if (!allFiles.includes(ignoreFilePath)) {
							allFiles.push(ignoreFilePath)
						}
					} catch {
						// Ignore file doesn't exist in this subdirectory
					}

					// Recurse into subdirectory
					await scanSubdirectories(subDirPath)
				}
			}
		} catch {
			// Can't read directory, skip
		}
	}

	await scanSubdirectories(absolutePath)

	return allFiles
}

/**
 * Create an ignore instance that loads all .gitignore files from the entire directory tree
 * @param dirPath - Directory path to start from
 * @returns Configured ignore instance that respects hierarchy
 */
export async function createGitignoreInstance(dirPath: string): Promise<Ignore> {
	const absolutePath = path.resolve(dirPath)

	// Find all .gitignore files from parent directories
	const gitignoreFiles = await findIgnoreFiles(absolutePath, ".gitignore")

	// Read and combine all gitignore contents
	let combinedContent = ""
	for (const gitignoreFile of gitignoreFiles) {
		try {
			const content = await fs.readFile(gitignoreFile, "utf8")
			if (content.trim()) {
				if (combinedContent) {
					combinedContent += "\n" + content
				} else {
					combinedContent = content
				}
			}
		} catch (err) {
			console.warn(`Error reading .gitignore at ${gitignoreFile}: ${err}`)
		}
	}

	// Create an ignore instance with all combined patterns
	const baseIgnore = ignore()
	if (combinedContent) {
		baseIgnore.add(combinedContent)
	}

	// Create a wrapper that always ignores .gitignore files themselves and .git directories
	const wrappedIgnore = {
		ignores: (filePath: string): boolean => {
			// Always ignore .gitignore files themselves
			if (path.basename(filePath) === ".gitignore") {
				return true
			}
			// Always ignore .git directories and their contents
			const normalizedPath = filePath.replace(/\\/g, "/")
			if (
				normalizedPath === ".git" ||
				normalizedPath.startsWith(".git/") ||
				normalizedPath.includes("/.git/") ||
				normalizedPath.endsWith("/.git")
			) {
				return true
			}
			return baseIgnore.ignores(filePath)
		},
		add: (pattern: string) => baseIgnore.add(pattern),
		filter: (paths: string[]) => paths.filter((p) => !wrappedIgnore.ignores(p)),
		createFilter: () => (path: string) => !wrappedIgnore.ignores(path),
		test: (path: string) => {
			const ignored = wrappedIgnore.ignores(path)
			return { ignored, unignored: !ignored }
		},
		checkIgnore: (path: string) => {
			const ignored = wrappedIgnore.ignores(path)
			return { ignored, unignored: !ignored }
		},
	} as unknown as Ignore

	return wrappedIgnore
}

/**
 * Create an ignore instance that loads all .rooignore files from the entire directory tree
 * @param dirPath - Directory path to start from
 * @returns Configured ignore instance and content string (for UI display)
 */
export async function createRooignoreInstance(dirPath: string): Promise<{ ignoreInstance: Ignore; content?: string }> {
	const absolutePath = path.resolve(dirPath)

	// Find all .rooignore files from parent directories
	const rooignoreFiles = await findIgnoreFiles(absolutePath, ".rooignore")

	// Read and combine all rooignore contents (most specific first)
	let combinedContent = ""
	// Reverse the order to put most specific (deepest) content first
	for (const rooignoreFile of [...rooignoreFiles].reverse()) {
		try {
			const content = await fs.readFile(rooignoreFile, "utf8")
			if (content.trim()) {
				if (combinedContent) {
					combinedContent += "\n" + content
				} else {
					combinedContent = content
				}
			}
		} catch (err) {
			console.warn(`Error reading .rooignore at ${rooignoreFile}: ${err}`)
		}
	}

	// Create an ignore instance with all combined patterns
	const baseIgnore = ignore()
	if (combinedContent) {
		baseIgnore.add(combinedContent)
	}

	// Create a wrapper that always ignores .rooignore files themselves and .git directories
	const wrappedIgnore = {
		ignores: (filePath: string): boolean => {
			// Always ignore .rooignore files themselves
			if (path.basename(filePath) === ".rooignore") {
				return true
			}
			// Always ignore .git directories and their contents
			const normalizedPath = filePath.replace(/\\/g, "/")
			if (
				normalizedPath === ".git" ||
				normalizedPath.startsWith(".git/") ||
				normalizedPath.includes("/.git/") ||
				normalizedPath.endsWith("/.git")
			) {
				return true
			}
			return baseIgnore.ignores(filePath)
		},
		add: (pattern: string) => baseIgnore.add(pattern),
		filter: (paths: string[]) => paths.filter((p) => !wrappedIgnore.ignores(p)),
		createFilter: () => (path: string) => !wrappedIgnore.ignores(path),
		test: (path: string) => {
			const ignored = wrappedIgnore.ignores(path)
			return { ignored, unignored: !ignored }
		},
		checkIgnore: (path: string) => {
			const ignored = wrappedIgnore.ignores(path)
			return { ignored, unignored: !ignored }
		},
	} as unknown as Ignore

	return {
		ignoreInstance: wrappedIgnore,
		content: combinedContent || undefined,
	}
}

/**
 * Create a combined ignore instance that respects both .gitignore and .rooignore files at any level
 * @param dirPath - Directory path to start from
 * @returns Combined ignore instance and rooignore content for UI display
 */
export async function createCombinedIgnoreInstance(
	dirPath: string,
): Promise<{ ignoreInstance: Ignore; rooignoreContent?: string }> {
	const gitignoreInstance = await createGitignoreInstance(dirPath)
	const { ignoreInstance: rooignoreInstance, content: rooignoreContent } = await createRooignoreInstance(dirPath)

	// Create a wrapper that checks both ignore instances
	// rooignore takes precedence over gitignore
	const combinedInstance = {
		ignores: (filePath: string): boolean => {
			// Always ignore .git directories and their contents first
			const normalizedPath = filePath.replace(/\\/g, "/")
			if (
				normalizedPath === ".git" ||
				normalizedPath.startsWith(".git/") ||
				normalizedPath.includes("/.git/") ||
				normalizedPath.endsWith("/.git")
			) {
				return true
			}
			// Check rooignore first (higher priority)
			if (rooignoreContent && rooignoreInstance.ignores(filePath)) {
				return true
			}
			// Then check gitignore
			return gitignoreInstance.ignores(filePath)
		},
		add: (pattern: string) => {
			// For combined instance, we don't support adding patterns
			throw new Error("Cannot add patterns to combined ignore instance")
		},
		filter: (paths: string[]) => {
			return paths.filter((p) => !combinedInstance.ignores(p))
		},
		createFilter: () => {
			return (path: string) => !combinedInstance.ignores(path)
		},
		test: (path: string) => {
			return { ignored: combinedInstance.ignores(path), unignored: !combinedInstance.ignores(path) }
		},
		checkIgnore: (path: string) => {
			const ignored = combinedInstance.ignores(path)
			return { ignored, unignored: !ignored }
		},
	} as unknown as Ignore

	return { ignoreInstance: combinedInstance, rooignoreContent }
}

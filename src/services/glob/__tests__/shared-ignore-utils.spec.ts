// npx vitest services/glob/__tests__/shared-ignore-utils.spec.ts

import { vi } from "vitest"
import * as fs from "fs/promises"
import * as path from "path"
import {
	findIgnoreFiles,
	createGitignoreInstance,
	createRooignoreInstance,
	createCombinedIgnoreInstance,
} from "../shared-ignore-utils"

// Mock fs module
vi.mock("fs/promises")

describe("shared-ignore-utils", () => {
	const mockFs = vi.mocked(fs)

	beforeEach(() => {
		vi.clearAllMocks()
	})

	describe("findIgnoreFiles", () => {
		it("should find ignore files walking up the directory tree", async () => {
			const testPath = "/workspace/deep/nested/folder"

			// Mock fs.access to simulate .gitignore files at different levels
			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.gitignore") || pathStr.includes("/workspace/deep/.gitignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			const result = await findIgnoreFiles(testPath, ".gitignore")

			// Should find files in order from root to most specific
			expect(result).toEqual([path.join("/workspace", ".gitignore"), path.join("/workspace/deep", ".gitignore")])
		})

		it("should return empty array when no ignore files exist", async () => {
			const testPath = "/workspace/folder"

			// Mock fs.access to always throw (no files exist)
			mockFs.access.mockRejectedValue(new Error("File does not exist"))

			const result = await findIgnoreFiles(testPath, ".gitignore")

			expect(result).toEqual([])
		})

		it("should handle root directory correctly", async () => {
			const testPath = "/"

			mockFs.access.mockRejectedValue(new Error("File does not exist"))

			const result = await findIgnoreFiles(testPath, ".gitignore")

			expect(result).toEqual([])
		})
	})

	describe("createGitignoreInstance", () => {
		it("should create ignore instance with patterns from multiple .gitignore files", async () => {
			const testPath = "/workspace/subfolder"

			// Mock findIgnoreFiles by mocking fs.access
			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.gitignore") || pathStr.includes("/workspace/subfolder/.gitignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			// Mock fs.readFile to return different content for each file
			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.gitignore")) {
					return "node_modules\n*.log"
				}
				if (pathStr.includes("/workspace/subfolder/.gitignore")) {
					return "dist\nbuild"
				}
				throw new Error("File not found")
			})

			const ignoreInstance = await createGitignoreInstance(testPath)

			// Test that patterns from both files are applied
			expect(ignoreInstance.ignores("node_modules/package.json")).toBe(true)
			expect(ignoreInstance.ignores("app.log")).toBe(true)
			expect(ignoreInstance.ignores("dist/index.js")).toBe(true)
			expect(ignoreInstance.ignores("build/output")).toBe(true)
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)
		})

		it("should handle missing .gitignore files gracefully", async () => {
			const testPath = "/workspace"

			mockFs.access.mockRejectedValue(new Error("File does not exist"))

			const ignoreInstance = await createGitignoreInstance(testPath)

			// Should still ignore .gitignore files themselves
			expect(ignoreInstance.ignores(".gitignore")).toBe(true)
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)
		})

		it("should continue on read errors", async () => {
			const testPath = "/workspace"

			// Mock access to succeed but readFile to fail
			mockFs.access.mockResolvedValue()
			mockFs.readFile.mockRejectedValue(new Error("Permission denied"))

			// Should not throw
			const ignoreInstance = await createGitignoreInstance(testPath)

			// Should still ignore .gitignore files themselves
			expect(ignoreInstance.ignores(".gitignore")).toBe(true)
		})

		it("should respect .gitignore hierarchy - files ignored only within their respective directories", async () => {
			const testPath = "/workspace/project"

			// Mock fs.access to simulate .gitignore files at different levels
			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.gitignore") || pathStr.includes("/workspace/project/.gitignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			// Mock fs.readFile to return different content for each .gitignore
			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.gitignore")) {
					return "*.log\ntemp"
				}
				if (pathStr.includes("/workspace/project/.gitignore")) {
					return "node_modules\nbuild\nfrontend/dist\nfrontend/.cache"
				}
				throw new Error("File not found")
			})

			const ignoreInstance = await createGitignoreInstance(testPath)

			// Test root level patterns (*.log, temp) apply everywhere
			expect(ignoreInstance.ignores("app.log")).toBe(true)
			expect(ignoreInstance.ignores("frontend/app.log")).toBe(true)
			expect(ignoreInstance.ignores("temp/file.txt")).toBe(true)
			expect(ignoreInstance.ignores("frontend/temp/file.txt")).toBe(true)

			// Test project level patterns (node_modules, build) apply within project
			expect(ignoreInstance.ignores("node_modules/package.json")).toBe(true)
			expect(ignoreInstance.ignores("build/index.js")).toBe(true)
			expect(ignoreInstance.ignores("frontend/node_modules/react")).toBe(true)
			expect(ignoreInstance.ignores("frontend/build/app.js")).toBe(true)

			// Test frontend level patterns (frontend/dist, frontend/.cache) defined in project .gitignore
			expect(ignoreInstance.ignores("frontend/dist/bundle.js")).toBe(true)
			expect(ignoreInstance.ignores("frontend/.cache/data")).toBe(true)

			// Test that frontend patterns don't apply outside frontend directory
			// (these should be false because only frontend/dist and frontend/.cache are ignored)
			expect(ignoreInstance.ignores("dist/global.js")).toBe(false)
			expect(ignoreInstance.ignores(".cache/root-cache")).toBe(false)
			expect(ignoreInstance.ignores("backend/dist/server.js")).toBe(false)

			// Test that files not matching any pattern are allowed
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)
			expect(ignoreInstance.ignores("frontend/src/component.tsx")).toBe(false)
		})
	})

	describe("createRooignoreInstance", () => {
		it("should create ignore instance with content from multiple .rooignore files", async () => {
			const testPath = "/workspace/subfolder"

			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/.rooignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.rooignore")) {
					return "secrets\n*.env"
				}
				if (pathStr.includes("/workspace/subfolder/.rooignore")) {
					return "temp\ncache"
				}
				throw new Error("File not found")
			})

			const { ignoreInstance, content } = await createRooignoreInstance(testPath)

			// Test that patterns from both files are applied
			expect(ignoreInstance.ignores("secrets/api-key")).toBe(true)
			expect(ignoreInstance.ignores("config.env")).toBe(true)
			expect(ignoreInstance.ignores("temp/file.txt")).toBe(true)
			expect(ignoreInstance.ignores("cache/data")).toBe(true)
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)

			// Test that content is combined (most specific first)
			expect(content).toBe("temp\ncache\nsecrets\n*.env")
		})

		it("should return undefined content when no .rooignore files exist", async () => {
			const testPath = "/workspace"

			mockFs.access.mockRejectedValue(new Error("File does not exist"))

			const { ignoreInstance, content } = await createRooignoreInstance(testPath)

			expect(content).toBeUndefined()
			expect(ignoreInstance.ignores(".rooignore")).toBe(true)
		})

		it("should respect .rooignore hierarchy - files ignored only within their respective directories", async () => {
			const testPath = "/workspace/project"

			// Mock fs.access to simulate .rooignore files at different levels
			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.rooignore") || pathStr.includes("/workspace/project/.rooignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			// Mock fs.readFile to return different content for each .rooignore
			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/workspace/.rooignore")) {
					return "*.env\nsecrets"
				}
				if (pathStr.includes("/workspace/project/.rooignore")) {
					return "credentials\napi-keys\nbackend/private\nbackend/config.local"
				}
				throw new Error("File not found")
			})

			const { ignoreInstance } = await createRooignoreInstance(testPath)

			// Test root level patterns (*.env, secrets) apply everywhere
			expect(ignoreInstance.ignores("app.env")).toBe(true)
			expect(ignoreInstance.ignores("backend/app.env")).toBe(true)
			expect(ignoreInstance.ignores("secrets/api.key")).toBe(true)
			expect(ignoreInstance.ignores("backend/secrets/token")).toBe(true)

			// Test project level patterns (credentials, api-keys) apply within project
			expect(ignoreInstance.ignores("credentials/user.json")).toBe(true)
			expect(ignoreInstance.ignores("api-keys/service.key")).toBe(true)
			expect(ignoreInstance.ignores("backend/credentials/db.json")).toBe(true)
			expect(ignoreInstance.ignores("backend/api-keys/auth.key")).toBe(true)

			// Test backend level patterns (backend/private, backend/config.local) defined in project .rooignore
			expect(ignoreInstance.ignores("backend/private/internal.js")).toBe(true)
			expect(ignoreInstance.ignores("backend/config.local")).toBe(true)

			// Test that backend patterns don't apply outside backend directory
			expect(ignoreInstance.ignores("private/frontend-data")).toBe(false)
			expect(ignoreInstance.ignores("config.local")).toBe(false)
			expect(ignoreInstance.ignores("frontend/private/component.tsx")).toBe(false)

			// Test that files not matching any pattern are allowed
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)
			expect(ignoreInstance.ignores("backend/src/server.js")).toBe(false)
		})
	})

	describe("createCombinedIgnoreInstance", () => {
		it("should combine patterns from both .gitignore and .rooignore files", async () => {
			const testPath = "/workspace"

			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/.gitignore") || pathStr.includes("/.rooignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes(".gitignore")) {
					return "node_modules\n*.log"
				}
				if (pathStr.includes(".rooignore")) {
					return "secrets\n*.env"
				}
				throw new Error("File not found")
			})

			const { ignoreInstance, rooignoreContent } = await createCombinedIgnoreInstance(testPath)

			// Test that patterns from both types are applied
			expect(ignoreInstance.ignores("node_modules/package.json")).toBe(true)
			expect(ignoreInstance.ignores("app.log")).toBe(true)
			expect(ignoreInstance.ignores("secrets/api-key")).toBe(true)
			expect(ignoreInstance.ignores("config.env")).toBe(true)
			expect(ignoreInstance.ignores("src/app.js")).toBe(false)

			// Test that rooignore content is returned
			expect(rooignoreContent).toBe("secrets\n*.env")
		})

		it("should handle cases where only .gitignore exists", async () => {
			const testPath = "/workspace"

			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/.gitignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes(".gitignore")) {
					return "node_modules"
				}
				throw new Error("File not found")
			})

			const { ignoreInstance, rooignoreContent } = await createCombinedIgnoreInstance(testPath)

			expect(ignoreInstance.ignores("node_modules/package.json")).toBe(true)
			expect(rooignoreContent).toBeUndefined()
		})

		it("should handle cases where only .rooignore exists", async () => {
			const testPath = "/workspace"

			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/.rooignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes(".rooignore")) {
					return "secrets"
				}
				throw new Error("File not found")
			})

			const { ignoreInstance, rooignoreContent } = await createCombinedIgnoreInstance(testPath)

			expect(ignoreInstance.ignores("secrets/api-key")).toBe(true)
			expect(rooignoreContent).toBe("secrets")
		})
	})

	describe("always ignore .git directories", () => {
		it("should always ignore .git directories regardless of .gitignore content", async () => {
			const testPath = "/workspace"

			// Mock a .gitignore that does NOT ignore .git (to test our override)
			mockFs.access.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes("/.gitignore")) {
					return Promise.resolve()
				}
				throw new Error("File does not exist")
			})

			mockFs.readFile.mockImplementation(async (filePath: any) => {
				const pathStr = filePath.toString()
				if (pathStr.includes(".gitignore")) {
					return "*.log\n!.git" // Explicitly try to NOT ignore .git
				}
				throw new Error("File not found")
			})

			// Test gitignore instance
			const gitignoreInstance = await createGitignoreInstance(testPath)
			expect(gitignoreInstance.ignores(".git")).toBe(true)
			expect(gitignoreInstance.ignores(".git/config")).toBe(true)
			expect(gitignoreInstance.ignores(".git/HEAD")).toBe(true)
			expect(gitignoreInstance.ignores("src/.git")).toBe(true)
			expect(gitignoreInstance.ignores("src/.git/config")).toBe(true)
			expect(gitignoreInstance.ignores("nested/path/.git/objects")).toBe(true)

			// Test rooignore instance
			const { ignoreInstance: rooignoreInstance } = await createRooignoreInstance(testPath)
			expect(rooignoreInstance.ignores(".git")).toBe(true)
			expect(rooignoreInstance.ignores(".git/config")).toBe(true)
			expect(rooignoreInstance.ignores(".git/HEAD")).toBe(true)

			// Test combined instance
			const { ignoreInstance: combinedInstance } = await createCombinedIgnoreInstance(testPath)
			expect(combinedInstance.ignores(".git")).toBe(true)
			expect(combinedInstance.ignores(".git/config")).toBe(true)
			expect(combinedInstance.ignores(".git/HEAD")).toBe(true)
			expect(combinedInstance.ignores("nested/.git/file")).toBe(true)
			expect(combinedInstance.ignores("some/deep/path/.git")).toBe(true)

			// Test that normal files are still processed normally
			expect(gitignoreInstance.ignores("app.log")).toBe(true) // Should be ignored by .gitignore
			expect(gitignoreInstance.ignores("src/app.js")).toBe(false) // Should not be ignored
		})
	})
})

import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import { fileURLToPath } from 'node:url'

export default defineConfig({
    plugins: [react()],
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: ['./src/__tests__/setup.ts'],
        alias: {
            '@': fileURLToPath(new URL('./src', import.meta.url)),
        },
        include: ['src/__tests__/**/*.test.ts', 'src/__tests__/**/*.test.tsx'],
        exclude: ['node_modules', '.next', 'dist'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'json', 'json-summary', 'html'],
            include: ['src/lib/**/*.ts', 'src/app/api/**/*.ts'],
            exclude: ['src/__tests__/**', 'node_modules/**'],
            // 略低于当前覆盖率，防止覆盖率下降；补充测试后可逐步提高
            thresholds: {
                statements: 70,
                branches: 65,
                functions: 75,
                lines: 70,
            },
        },
    },
})
